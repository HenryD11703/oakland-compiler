# Stage 2 — Spec: classes and a WebAssembly compiler

> Status: **approved by Henry on 2026-10-15** (gate a). Henry said "give me everything recommended" without reading the document first, so the five questions at the end are answered **yes, as recommended**, and every **[Henry?]** item below stands as written. He can still change any of them; if he does, this line says so. Items marked **[Henry?]** were my proposals where nothing was decided. Stage 1 (the interpreter playground, `docs/00-principles.md` to `03-tasks.md`) is done and stays as it is. Stage 2 adds two things Henry asked for on 2026-10-14 and confirmed on 2026-10-15: **classes** and **compiling OakLand to WebAssembly**.

## What it is

OakLand grows from "a language with an interpreter you can watch" into **a language with two ways to run it**: the interpreter (slow, tolerant, shows every step) and a **compiler that turns a program into a real WebAssembly binary** that the browser runs at machine speed. The same program gives the same output in both, and a test proves it.

## Who it is for

| Who | What they get |
|---|---|
| A reviewer (engineer or recruiter) | One click: *Compile and run*, then the generated WebAssembly next to the source, and a number: how many times faster it ran. Proof of fundamentals that most portfolios do not have. |
| A student | See what a compiler produces for `a + b * 2`, for a loop, for a method call on a subclass (virtual dispatch). |
| Henry | Types, code generation, memory layout, a runtime, differential testing: the parts of compilers that frameworks hide. |

## Scope

**In:** classes (fields, constructors, methods, `this`, single inheritance, overriding, virtual calls, `private`); a static type checker; a compiler to WebAssembly with its own binary encoder, a text (WAT) view and a small runtime (memory, strings, arrays, objects); runtime errors with positions in compiled code; a differential test suite (interpreter versus compiler); the UI for both modes; benchmarks; documentation.

**Out of this stage:** interfaces, abstract classes, generics, `static` members, method overloading, exceptions (`try`/`catch`), a garbage collector (memory is never freed; see D16), compiler optimisations, debugging compiled code step by step, a native x86 or ARM backend, sharing programs by link, a light theme.

**Stretch, only if the rest is done and verified:** `instanceof`; constant folding with a before/after size in the UI; a mark-and-sweep collector; a native backend through LLVM.

## Language: classes

The syntax follows Java, as decided on 2026-10-15. Full reference goes in `docs/LANGUAGE.md` and its code blocks are executed by tests, as in stage 1.

```java
class Animal {
    string name;
    Animal(string name) { this.name = name; }
    string sound() { return "..."; }
    void speak() { System.out.println(name, "says", sound()); }
}

class Dog extends Animal {
    private int tricks;
    Dog(string name, int tricks) { super(name); this.tricks = tricks; }
    string sound() { return "Woof"; }
    int getTricks() { return tricks; }
}

Animal a = new Dog("Rex", 3);
a.speak();                  // Rex says Woof  (the method of the real class runs)
```

- **S-01** A class has fields, constructors and methods. `new Dog("Rex", 3)` allocates an object and runs the constructor. A class without a constructor has an empty one. Constructors are chosen by number of arguments (no overloading of two constructors with the same count).
- **S-02** `this` is the object a method or constructor works on. A bare field name inside a method means `this.name`; a local or parameter with the same name hides it.
- **S-03** `obj.method(args)` calls a method; the arguments and the result are type-checked like function calls (stage 1, AC-14 and AC-15). `obj.field` reads and assigns a field, including `++`, `--`, `+=`.
- **S-04** Single inheritance with `extends`. A subclass has the fields and methods of its parent. If the parent has no constructor that takes zero arguments, the subclass constructor must start with `super(...)`. `super.method(args)` calls the parent's version.
- **S-05** A method with the same name, parameter types and return type as one in a parent class **overrides** it, and a call through a variable of the parent type runs the real class's method (virtual dispatch). A method that differs in parameters or return type is a diagnostic, not an overload.
- **S-06** A `Dog` can be stored where an `Animal` is expected (variables, parameters, returns, array elements). The reverse is a diagnostic. `null` can be stored in any class variable.
- **S-07** A `private` field or method can be used only inside its own class (not even in a subclass). Without a modifier, or with `public`, it is open. Using it elsewhere is a diagnostic at that position.
- **S-08** Reading a field or calling a method on `null` is a runtime diagnostic (`null reference: ...`) with the position, never a host exception. In the interpreter the run continues as in stage 1 (poison value); in compiled code it ends the run (S-18).
- **S-09** Every mistake a user can make with classes is a diagnostic with a position: unknown class, unknown field or method, wrong number or type of arguments, a class that extends itself or a cycle, a duplicate class, field or method, `super(...)` missing or not first, a missing `return`, `this` outside a class, `new` on something that is not a class.
- **S-10** The interface shows objects. *Variables* lists an object as `Dog` with its fields (fields of the parent included); *Symbols* lists classes, fields and methods; *Syntax tree* draws them; the trace records field changes. Cycles (a node pointing to its parent) do not hang the page.
- **S-11** Structs keep working unchanged. A class is a struct with behaviour; they stay separate keywords.

## Static type checker

Stage 1 decided to check types while the program runs (D4), because the sample `basicas.oak` mixes wrong statements with right ones and expects the right ones to run. A compiler cannot do that: it needs the type of every expression before it writes code. So stage 2 adds a **checker** and keeps both behaviours:

- **Interpret mode stays tolerant**, as in stage 1, extended with classes. It does not need the checker to run.
- **Compile mode requires a clean check.** If the checker finds an error the program does not compile and each error is shown with its position.

- **S-12** `check(source)` returns the diagnostics of the whole program without running it, for every kind of mistake the interpreter finds when it runs, with the same wording. It never throws.
- **S-13 [Henry?] Definite assignment.** A local variable of a primitive type that is read before it is given a value is a **checker error**, like Java. In the interpreter `int n;` keeps holding `null` and printing it prints `null` (stage 1, AC-08), so the old samples are not broken. Fields without an initial value start at the Java default in **both** modes: `0`, `0.0`, `false`, the character with code 0, and `null` for everything else.
- **S-14 [Henry?] Ternary type.** `c ? a : b` has one static type: the two branches must have the same type, or one widens to the other (`int` and `float` give `float`). In stage 1 the type of the chosen branch was used (`true ? 1 : 2.5` was the `int` `1`); the interpreter changes to the new rule, and the change is listed in `docs/language-changes.md`.
- **S-15** A program the checker accepts never produces a *type* diagnostic when interpreted. This is a test (the interpreter runs every clean corpus program and expects none).

## The compiler

- **S-16** `compile(source)` returns `{ wasm, wat, diagnostics, ... }`: the binary module, its text form, and the diagnostics of the checker. It never throws. For every program the checker accepts, `WebAssembly.validate(wasm)` is true (a fuzz test enforces it).
- **S-17 Equivalence.** For every program in the corpus that the checker accepts and that ends without a runtime error, the compiled program's output is **byte for byte** the interpreter's output. The corpus is: every clean stage 1 sample, every example, the new class programs, and at least 200 programs generated from a seeded random generator of typed expressions and statements. A test runs both and compares.
- **S-18 Runtime errors in compiled code** (division by zero, index out of range, null reference, out of memory, stack overflow) **end the run** with a diagnostic that has the source position and the same wording as the interpreter's, and the output printed so far is kept. (The interpreter continues after such an error; that difference is listed in `docs/language-changes.md`. The equivalence test of S-17 covers only runs that end without a runtime error, and a second test checks that both modes report the same first error.)
- **S-19** `int` is 32-bit with wrap-around, `/` truncates, `%` takes the sign of the left side, `float` is a 64-bit double printed Java-style, `char` is a number in arithmetic, `string + anything` concatenates, strings compare by value and lexicographically by UTF-16 code unit (all as in stage 1, AC-01 to AC-04).
- **S-20 Limits.** Memory is capped at 256 MiB; a program that needs more ends with `out of memory`. Deep recursion ends with `stack overflow`. A program that never ends is ended by **Stop** and by the 5 s hard timeout of stage 1 (the page never freezes: the compiled program runs in a Worker).
- **S-21 No compiler dependencies.** The binary encoder, the text printer and the runtime are written in this repository. No `binaryen`, no `wabt`, no Rust or C toolchain. The engine's own `WebAssembly.validate` is the independent check.
- **S-22 Numbers, measured not promised.** The README reports, for four benchmark programs (a counting loop of a million iterations, recursive Fibonacci, a prime sieve, an object-heavy method-call loop), the median of five runs in the interpreter (with and without the trace) and compiled, and says on which machine. A target, not a promise: the compiled loop runs at least 20 times faster than the interpreter's.

## The interface

- **S-23** A mode switch next to *Run*: **Interpret** (as today, with the timeline) and **Compile**. Both work from the keyboard (`Ctrl/Cmd+Enter` runs the current mode).
- **S-24** In Compile mode the page shows the output, the problems, and a **Compiled** panel: the WebAssembly text with the functions foldable, the size in bytes, the time to compile and the time to run. Clicking a function jumps to its source (and a source line to its function) where the mapping exists. The timeline is replaced by a sentence saying why it is not available.
- **S-25** **Compare** runs both modes on the same program and shows the two times side by side, the ratio, and whether the outputs are identical.
- **S-26** Compiling and running happen in the Worker with the same Stop and the same hard timeout as stage 1. No program can freeze the page.
- **S-27** The new panels and the mode switch pass axe at 1280 and 375 px, work from the keyboard, and follow the dark theme and the resizable panels of the current interface.
- **S-28** Three mockups of the new panels are shown to Henry before the interface is built (approval gate b).

## Documentation and quality

- **S-29** `docs/LANGUAGE.md` documents classes with executable examples; `docs/COMPILER.md` explains the pipeline with one worked example followed from source to IR to WAT to bytes; `docs/ARCHITECTURE.md` records the decisions and what was rejected; `docs/language-changes.md` lists every change to what programs mean or print.
- **S-30** CI stays green on every commit (check, build, audit, E2E). The criterion-to-test table at the end of `03-tasks.md` is filled in as tasks close.
- **S-31** Everything the users and contributors read is in English.

## What I could not decide alone

| # | Question | My recommendation |
|---|---|---|
| 1 | S-13: reading an unassigned `int` is a checker error (compile mode only) | Yes. WebAssembly has no `null` for an `int`; Java does the same. |
| 2 | S-14: the ternary gets one static type | Yes. A compiler cannot know which branch will run. |
| 3 | S-18: compiled runtime errors end the run | Yes. Continuing after a failed expression needs the interpreter's "poison" value everywhere in compiled code, which costs speed and clarity. |
| 4 | No garbage collector (memory is never freed) | Yes for now; the cap makes it safe, and a collector is a stretch. |
| 5 | Classic WebAssembly with linear memory, not the newer WasmGC | Yes: more to learn (layouts, an allocator, vtables), and it runs in every engine. |
