# Stage 2 — Technical plan

> Status: **approved by Henry on 2026-10-15**, with the spec (see its status line). Continues the numbering of `docs/02-plan.md` (D1 to D12). Each decision lists what was rejected and why.

## Shape of the code

```
src/core/
  lexer/ parser/            + class, extends, new, this, super, private, public
  interpreter/              + objects, methods, dispatch (stage 1 semantics kept)
  check/                    NEW  types.ts  classes.ts  expressions.ts  statements.ts  check.ts
  compile/                  NEW
    ir.ts                   typed, structured, wasm-shaped instruction tree
    lower.ts                checked AST -> IR (expressions, control flow, calls, classes)
    runtime.ts              the runtime written as IR: allocator, strings, arrays, errors
    layout.ts               object, string and array memory layout; vtables
    encode.ts               IR -> binary (LEB128, sections, function bodies)
    wat.ts                  IR -> text
    host.ts                 the imports a program may call (print, float formatting, ...)
    index.ts                compile(source) -> CompileResult
  run.ts                    run(source) as today;  + runCompiled(wasm)
src/worker/                 + "compile" and "runCompiled" messages
src/ui/                     + mode switch, Compiled panel, Compare
tests/ differential/        NEW  harness, corpus, generator, benchmarks
docs/stage-2/  docs/COMPILER.md
```

`compile()` is pure TypeScript with no DOM, like the rest of `src/core` (principle 1).

## Decisions

**D13 — A separate static checker, used by Compile mode; Interpret mode stays tolerant.**
Reverses D4 only where D4 cannot hold: a compiler needs a type for every expression. D4's reason (the samples mix wrong and right statements and expect the right ones to run) still holds for the interpreter, so Interpret mode keeps running without the checker. The two share the type rules (`interpreter/types.ts`, moved to `core/types.ts`).
Rejected: *make the interpreter use the checker and refuse programs with errors* (breaks stage 1 AC-22 and the samples' purpose); *compile despite errors by emitting traps* (hides mistakes and makes S-17 meaningless).

**D14 — Target: classic WebAssembly (MVP plus bulk memory and sign extension), linear memory, `i32` and `f64` only.**
`int`, `char`, `boolean` and pointers are `i32`; `float` is `f64`. Virtual calls use a function table and `call_indirect`. No `i64`, no SIMD, no threads, no WasmGC.
Rejected: *WasmGC* (the engine allocates and collects objects; the interesting parts disappear and tests depend on engine support); *a bytecode VM of our own* (the same compiler front half, but nothing runs at machine speed, which was the point of the question); *x86-64 or ARM64 machine code* (an ELF writer, a register allocator and an assembler for a result that cannot run in the browser); *LLVM IR* (needs `clang` installed and hides code generation); *JavaScript through `new Function`* (fast, but it is a transpiler, not a compiler, and unsafe by nature).

**D15 — One IR, two writers.**
`lower.ts` produces a typed tree of wasm-shaped instructions with structured control flow (`block`, `loop`, `if`, `br`). The binary encoder and the text printer both read that tree, so the text the UI shows is exactly the module that runs. The IR keeps a source position on every instruction that can fail, which gives S-18 and the jump from a function to its source.
Rejected: *emit text and assemble it with `wabt`* (a dependency that does the interesting part; S-21); *emit bytes directly from the AST* (no text view, no place to test the pieces).

**D16 — Memory model, an allocator that never frees, and a hand-written runtime.**
- Address 0 is reserved, so `null` is `0`.
- A **string** is `[length: i32][UTF-16 code units]`, which gives JavaScript's and the interpreter's `length`, comparison and indexing for free. String literals live in a data segment.
- An **array** is `[length: i32][elements]` with 4- or 8-byte elements; a matrix is an array of array pointers.
- An **object** is `[class id: i32][fields...]`, fields laid out in declaration order after the parent's. The class id indexes a table of vtables (a row of function-table indices), so a virtual call is: load class id, load the slot, `call_indirect`.
- The allocator is a **bump pointer** that grows the memory with `memory.grow` up to the cap of S-20. Nothing is freed. A stretch task replaces it with a mark-and-sweep collector.
- The runtime (`alloc`, string concatenation and comparison, integer to string, array bounds check, class-id checks) is written in the IR through a small TypeScript builder, so it appears in the WAT view like any other function.
Rejected: *a runtime written in Rust or C and compiled to Wasm* (a toolchain in CI, and an opaque binary blob in the repo); *a runtime in JavaScript called through imports for everything* (slow, and it would hide the memory model).

**D17 — The host imports are few and listed.**
`env.print(ptr, len)`, `env.format_float(x) -> ptr` (a Java-style `double` to string), `env.parse_float(ptr) -> f64`, `env.now() -> ptr` (for `time()`), and `env.fail(code, positionId)` for runtime errors, which throws a JavaScript error that the runner turns into a diagnostic.
Why not format floats in Wasm: shortest round-trip formatting of a double (Ryu, Grisu) is a project of its own, and calling the same JavaScript routine as the interpreter makes S-17 true by construction for floats. The README says this plainly under "Honest limits". Everything else, including integer formatting, is compiled.
Rejected: *all I/O through WASI* (not needed in a browser page; no gain).

**D18 — Runtime errors abort; positions come from a table.**
Operations that can fail (division, indexing, field access, allocation) check first and call `env.fail(code, positionId)`. `positionId` indexes a table of `{line, column}` returned with the module, so the binary does not embed text. WebAssembly's own traps (stack overflow, unreachable) are caught by the runner and mapped to `stack overflow` / `internal error`.
Rejected: *poison values in compiled code* (every value needs a flag; slow and unreadable); *the engine's traps alone* (`RuntimeError: divide by zero` has no source position).

**D19 — Order of work: the interpreter learns classes first, then the checker, then the compiler.**
Each stage then has an oracle: the interpreter checks the checker's types (S-15), and the interpreter checks the compiler's output (S-17). The compiler grows in vertical slices: a constant, then arithmetic, then control flow, then functions, then memory, then classes, each one tested against the interpreter before the next starts.

**D20 — Tests, in layers (extends D9).**
- *Unit*: the encoder (LEB128 against known vectors, sections, a hand-assembled module that runs in Node), each lowering rule, each runtime function.
- *Differential* (the important one): run every corpus program in both modes and compare stdout. The corpus is the clean stage 1 samples, the examples, class programs, and a **seeded generator** of well-typed programs (arithmetic with overflow, mixed `int`/`float`/`char`/`string`, loops, functions, arrays, classes with overrides). A failure prints the seed and a minimised program.
- *Fuzz*: `compile()` must never throw on mutated programs, and every module it returns for a clean program must pass `WebAssembly.validate`.
- *Golden WAT*: six small programs have their WAT committed, so a reviewer reads what changed in a diff.
- *Error parity*: the same first runtime error, with the same position and wording, in both modes.
- *E2E*: Compile mode runs an example, shows the panel, Stop ends a compiled infinite loop, Compare shows equal outputs; axe on the new panels.

**D21 — Benchmarks are a script, not an opinion.**
`npm run bench` runs the four programs of S-22, five times each, in Node (V8), and prints a table with the Node version and CPU. The README quotes that table. Browser numbers are measured separately and labelled.

**D22 — UI: the compiled view is a panel, not a new screen.**
It joins *Output · Problems · Syntax tree · Symbols* as *Compiled*, in the existing resizable column. The mode switch sits beside *Run*. Three mockups come before the code (S-28).
Rejected: *a separate page* (the point is seeing source and binary together).

## Risks

- **Scope.** This is the biggest part of the work: a checker, an encoder, a runtime and a language extension. Mitigation: the cut list in the spec; vertical slices, each verified before the next; the stretch items are cut first.
- **Interpreter and compiler drift.** Mitigation: the differential suite runs in CI on every commit; D19's order.
- **Float and string semantics** (formatting, UTF-16, comparison). Mitigation: float formatting through the host (D17); strings in UTF-16 (D16); the generator includes mixed-type expressions.
- **Debugging bytes.** Mitigation: the text printer comes second, right after the encoder, and every slice has a golden WAT.
- **Engines differ.** Everything used is in the WebAssembly 2.0 core that V8, SpiderMonkey and JavaScriptCore ship. CI tests Chromium; Firefox and WebKit are added as Playwright projects for a smoke test if the cost is small.
- **Memory growth** with no collector. Mitigation: the 256 MiB cap and a clear diagnostic; the README lists it as a limit.
- **Unverified today:** real speed-ups in browsers, and compile times for large programs. Both are measured during the work.
