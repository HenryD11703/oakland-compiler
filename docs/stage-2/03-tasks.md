# Stage 2 — Tasks

> Status: **DRAFT, waiting for Henry's approval of the spec and the plan (gate a).** Nothing here is started. Numbering continues from `docs/03-tasks.md` (T01 to T28). Order matters. Each task has a "done when" and the criteria (S-xx) from `01-spec.md` it covers. Estimates are in work sessions (one sitting of focused work) and are honest and rough: **about 24 to 30 sessions in all**, and the plan says what to cut if that is too much.

## Phase 0 — Before any code (1 session)
- **T30 Baseline and benchmarks.** Write `npm run bench` with the four programs of S-22 and run it against the interpreter as it is today, with and without the trace. *Done when:* a table with the Node version, the CPU and the medians of five runs is committed. Covers: S-22 (the "before" half). It also answers the open question of stage 1: how much of the 4.8 s on the million-iteration loop is the trace.
- **T31 Gate (a).** Henry answers the five questions at the end of the spec. *Done when:* the spec says "approved" and the [Henry?] marks are resolved.

## Phase A — Classes in the interpreter (5 sessions)
- **T32 Grammar and lexer.** `class`, `extends`, `new`, `this`, `super`, `private`, `public` as keywords; `grammar.ebnf` first. *Done when:* every stage 1 program still tokenises and parses, and a name that starts with one of the new words (`classic`, `newest`) is still a valid name. Covers: S-01, S-04, S-07 (syntax).
- **T33 Parser and AST.** Class declarations, constructors, methods, `new C(args)`, `this.x`, `super(...)`, `super.m(...)`, with error recovery. *Done when:* a corpus of broken class syntax gives positioned, readable errors (up to 10 per run) and the golden parse trees match. Covers: S-01 to S-04, S-09 (syntax).
- **T34 Interpreter: objects and methods.** Instances, constructors and `this`, fields with defaults, methods, `private`, `null` access. *Done when:* AC-style unit tests for S-01 to S-03, S-07, S-08 pass. Covers: S-01 to S-03, S-07, S-08, S-11.
- **T35 Interpreter: inheritance and dispatch.** `extends`, `super`, overriding, virtual calls, assignability, cycles. *Done when:* the Animals example prints what Java prints. Covers: S-04 to S-06, S-09.
- **T36 Symbols, AST view, trace and the Variables panel for objects.** *Done when:* objects, classes, fields and methods show in the three views, a parent–child cycle does not hang, and the replay property test still holds with objects. Covers: S-10.
- **T37 Language reference, examples, error corpus.** Classes in `LANGUAGE.md` (executed by the doc test), three examples (Animals, Bank account, a linked list), a corpus of class mistakes with exact positions. *Done when:* the fuzz test runs over the new examples and `run()` never throws. Covers: S-09, S-29 (part).

**Gate:** I show Henry `docs/language-changes.md` and the class examples before Phase B.

## Phase B — The static checker (4 sessions)
- **T38 Types and the class table.** One shared type module; the table of classes, fields, methods, parents, with cycle and duplicate detection. *Done when:* unit tests for assignability including subclasses and `null`.
- **T39 Expressions.** A static type for every expression, widening, strings, the ternary rule, calls, members, `new`. *Done when:* a table of 100+ expression cases gives the types Java gives. Covers: S-12, S-14.
- **T40 Statements and flow.** Declarations, `var`, assignments, loops, `switch`, returns (every path returns), `break`/`continue` placement, definite assignment. *Done when:* the stage 1 error samples give the same messages as the interpreter's. Covers: S-12, S-13.
- **T41 Class rules.** Overrides, `super(...)`, `private`, constructor arity, `this` placement. *Done when:* every diagnostic of S-09 is produced with a position. Covers: S-09, S-12.
- **T42 Agreement with the interpreter.** For the whole corpus: if the checker is clean the interpreter reports no type diagnostic; if the interpreter reports one, the checker reports it too. *Done when:* the test passes and the few intended differences are listed. Covers: S-15.

## Phase C — The compiler (8 sessions, in vertical slices)
- **T43 IR and binary encoder.** The IR types; LEB128; type, import, function, table, memory, global, export, element, code and data sections. *Done when:* a module built by hand in a test (`add(a, b)`) passes `WebAssembly.validate` and returns the right value in Node. Covers: S-16, S-21.
- **T44 Text printer.** IR to WAT, with function names and comments. *Done when:* the printed text of the hand-built module is what a person would write, and it is committed as the first golden WAT. Covers: S-24 (data).
- **T45 Numbers, booleans, locals, control flow, functions.** `int` and `float` arithmetic with 32-bit wrap and truncating division, comparisons, short-circuit, `if`, `while`, `for`, `switch`, `break`/`continue`, calls and recursion; `println` for numbers through the host. *Done when:* the differential harness passes on every corpus program that uses only these features. Covers: S-16, S-17, S-19.
- **T46 Memory, the allocator and strings.** Reserved address 0, bump allocation with `memory.grow` and the cap, string literals in a data segment, concatenation, comparison, integer to string, float to string through the host, `char`. *Done when:* the string samples pass the harness. Covers: S-17, S-19, S-20.
- **T47 Arrays and matrices.** Allocation, bounds checks, `.length`, `.indexOf`, `.join`, for-each, copy on `int[] b = a;` (stage 1 semantics). *Done when:* `arrays.oak` passes the harness. Covers: S-17.
- **T48 Structs and classes.** Layout, field access, constructors, inheritance, vtables, `call_indirect`, `null` checks, `private` (compile-time only). *Done when:* the three class examples pass the harness. Covers: S-01 to S-06, S-17.
- **T49 Built-ins.** `parseInt`, `parseFloat`, `toString`, `toLowerCase`, `toUpperCase`, `typeof` (a constant, since types are static), `time()`, `obtenerLongitudArray`. *Done when:* AC-16 of stage 1 holds in compiled code. Covers: S-17.
- **T50 Runtime errors.** The position table, `env.fail`, the runner that turns it into a diagnostic, the stack-overflow trap; the error-parity test. *Done when:* each kind of runtime error gives the same first diagnostic, position and wording in both modes, with the output so far kept. Covers: S-18, S-20.
- **T51 `compile()` and the guarantees.** The entry point; never throws; limits. *Done when:* the fuzz test over mutated programs passes (no throw, and `WebAssembly.validate` on every module returned for a clean program). Covers: S-16, S-20.

## Phase D — Verification (3 sessions)
- **T52 The differential harness in CI.** All corpus programs, both modes, stdout compared; failures print the program. *Done when:* it runs in `npm run check` in under 30 s. Covers: S-17.
- **T53 The program generator.** Seeded, well-typed, with overflow, mixed numeric types, strings, loops, functions, arrays, classes with overrides; a minimiser for failures. *Done when:* 200 seeds pass, and a deliberately broken compiler (a mutation) is caught within the 200. Covers: S-17.
- **T54 Benchmarks and numbers.** The final `npm run bench` table, in Node and in a browser, labelled. *Done when:* the numbers are in the README with the machine named, whatever they are. Covers: S-22.

## Phase E — The product (4 sessions)
- **T55 Design: three mockups.** The Compiled panel, the mode switch and Compare, at 1280 and 375 px, with real data from the sieve example, in the dark theme. *Done when:* Henry picks one (**approval gate b**). Covers: S-28.
- **T56 Worker protocol.** `compile` and `runCompiled` messages; Stop; the hard timeout; a fresh worker per run. *Done when:* an E2E ends a compiled infinite loop and the page stays usable. Covers: S-20, S-26.
- **T57 Interface.** Mode switch, Compiled panel with foldable functions and the jump to source, sizes and times, Compare. *Done when:* the flow "pick Sieve → Compile → see the WAT → Compare" works by mouse and by keyboard. Covers: S-23 to S-25.
- **T58 E2E and accessibility.** Playwright at 1280 and 375 px with axe on the new panels. *Done when:* CI is green. Covers: S-27.

## Phase F — Closing (2 sessions)
- **T59 Documentation.** `COMPILER.md` with the worked example, `ARCHITECTURE.md`, `LANGUAGE.md`, `language-changes.md`, the repository `README.md` and `CLAUDE.md` for stage 2. *Done when:* a person who has never seen the project can follow `COMPILER.md` from a source line to its bytes. Covers: S-29, S-31.
- **T60 Verify and publish.** Everything in `npm run check`, `npm run build`, `npm audit --omit=dev`, E2E; the table "criterion → test" below is complete. Publishing, a tag and the deployment need Henry's OK. Covers: S-30.

## If it is too much
Cut from the end of the list, never from the middle: first the stretch items, then Compare (T57 part), then foldable functions and the jump to source, then Phase E's browser benchmark, then arrays of classes in compiled code. What must stay for the stage to be worth showing: T43 to T51 for numbers, strings, arrays and classes, the differential suite of Phase D, and a Compile button with the WAT visible.

## Table: criterion → test
Filled in as tasks close.

| Criterion | Checked by |
|---|---|
| S-01 … S-31 | *(pending)* |
