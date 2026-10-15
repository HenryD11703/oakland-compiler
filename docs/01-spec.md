# 01 — Spec

> Status: **approved by Henry on 2026-10-15** (including the six proposals marked [Henry?]; the spec says "draft" no more). Items marked **[Henry?]** are my proposals where nothing was decided yet; they need a yes/no at the approval gate.

## What it is

**OakLand** is a small Java-like language (static types, arrays and matrices of any depth, functions, structs) with an interpreter that runs in the browser. This project turns the original university interpreter into a **playground that shows how a program runs**: you write OakLand, press Run, and then step through the execution while watching the AST, the symbol table, the variables and the output.

## Who it is for

| Who | What they want in the first minute |
|---|---|
| A reviewer (engineer or recruiter) opening the link | See it do something impressive without reading anything: pick an example, press Run, step through it. Judge the code quality afterwards. |
| A student learning how interpreters work | See *why* a program printed what it printed: which statement ran, what the variables held, what the tree looked like. |
| Henry | A portfolio piece that shows lexer → parser → interpreter design, testing discipline and product thinking. |

## Scope

**In:** the language (existing syntax + `++`/`--` + working structs), diagnostics with positions, the four views (output, problems, AST/symbols, trace), step-through replay, examples, docs, tests, CI, deployment.

**Out (for v1):** new syntax beyond `++`/`--`; a static type checker as a separate pass (type errors are found while running, as today); live debugging with breakpoints (the trace is a recorded replay); sharing programs by link; accounts or storage; light theme; compiling to bytecode or WebAssembly; localisation (UI is English only).

## Language rules

Syntax is unchanged from the original except where stated. The full reference lives in `docs/LANGUAGE.md`; its code blocks are executed by tests.

### Numbers, strings, operators
- **AC-01** `int` is a 32-bit signed integer. `7 / 2` is `3`, `-7 / 2` is `-3`, `7 % 3` is `1`, `2147483647 + 1` is `-2147483648`. `int` with `float` gives `float`.
- **AC-02** `float` is an IEEE double. It prints Java-style: `5.0`, `2.5`, `0.30000000000000004`.
- **AC-03** Division or modulo by zero (int or float) is a runtime diagnostic; the expression has no value and nothing cascades.
- **AC-04** `==` and `!=` compare strings by value; `<`, `<=`, `>`, `>=` compare strings lexicographically. `string + int/float/boolean/char` concatenates. `char + int` is `int` (`'a' + 1` is `98`).
- **AC-05** `&&` and `||` short-circuit: `false && a[9] > 0` does not evaluate `a[9]`.
- **AC-06** `i++` and `i--` exist **as statements and in the update clause of `for`**, on variables, array elements and struct fields. They are not expressions (`a[i++]` is a syntax error with a clear message). **[Henry?]** The original forced `i += 1`; `+=` and `-=` keep working.

### Names and declarations
- **AC-07** A name may start with a keyword: `trueValue`, `nullable`, `integer`, `format` are valid names. A reserved word on its own is not a valid name (diagnostic: `'int' is a reserved word`).
- **AC-08** `int n;` (no initial value) declares `n` holding `null`; printing it prints `null`; assigning later works.
- **AC-09** Using an undeclared variable, assigning to one, or declaring a name twice in the same scope are diagnostics. One mistake yields one diagnostic (no follow-up errors from the same cause).
- **AC-10** `var x = expr;` infers the type; `typeof x` returns it as a string.

### Control flow
- **AC-11** `if/else`, `while`, `for`, `for (T x : array)`, `switch` (with fall-through and `default`), ternary `?:`, `break`, `continue`, `return` behave as in the original samples.
- **AC-12** `break` or `continue` outside a loop/switch, and `return` outside a function, are diagnostics reported with their position (never a host exception).

### Functions
- **AC-13** Functions can be called before the line where they are declared.
- **AC-14** A call to an unknown function, with the wrong number of arguments, or with an argument of the wrong type is a diagnostic naming the function and what was expected.
- **AC-15** The returned value must match the declared type; a non-`void` function that ends without `return` is a diagnostic. Recursion deeper than the call-depth limit is a diagnostic (`stack overflow`), not a host exception.
- **AC-16** Built-ins work as documented, all of them: `System.out.println(a, b, ...)`, `parseInt` (truncates), `parseFloat`, `toString`, `toLowerCase`, `toUpperCase`, `typeof`, `time()`, `obtenerLongitudArray(array)`; and array members `.length`, `.indexOf(x)`, `.join()`.

### Arrays, matrices, structs
- **AC-17** Arrays and matrices of any depth (`int[] a = {1,2}`, `new int[5]`, `int[][] m = new int[2][3]`, copy from another array) behave as in the original. An out-of-range index is a diagnostic that states the index and the length.
- **AC-18** **Structs [Henry?]** (proposed syntax; the original grammar had no way to read a field):
  ```
  struct Pet { string name; }
  struct Person { string name; int age; Pet pet; }

  Person p = Person{name: "Ana", age: 20, pet: Pet{name: "Rex"}};
  p.age = 21;
  p.age++;
  System.out.println(p.name, p.pet.name, typeof p);   // Ana Rex Person
  ```
  Fields not given are `null`. An unknown field, or a value of the wrong type, is a diagnostic. A trailing `;` after the closing brace of a `struct` declaration is accepted (the original required it). Printing a struct prints `Person{name: Ana, age: 21, pet: Pet{name: Rex}}`.

### Compatibility
- **AC-19** All seven programs in `Prueba/` run to completion without a host exception. Their output equals the output of the original interpreter (commit `11b0e46`, captured before any change) except for the differences listed in `docs/language-changes.md`.

## Diagnostics

- **AC-20** A diagnostic has: phase (`lexical`, `syntax`, `semantic`, `runtime`), a message in plain English, and a span (start and end line/column). Messages say what was expected, in human words (`expected ';' after the declaration`), not a list of tokens.
- **AC-21** The parser recovers from syntax errors and reports up to 10 of them in one run. If there is any syntax error, the program is not executed.
- **AC-22** Semantic and runtime errors do not stop the program: the failing statement reports one diagnostic and execution continues with the next one (this is what `Prueba/basicas.oak` relies on).
- **AC-23** `run()` never throws for any input: a fuzz test feeds 1,000 deterministic mutations of the sample programs and checks that every call returns a result.

## Execution safety

- **AC-24** Runs happen in a Web Worker. Defaults: 2,000,000 evaluation steps, 5 seconds, call depth 1,000, 200 KB of output. Reaching a limit stops the run with a diagnostic on the offending statement and keeps the output produced so far.
- **AC-25** A Stop button cancels a running program within 500 ms, and the page stays responsive during the run (a `while (true) {}` can be started and stopped).

## The views

- **AC-26 Editor.** Syntax highlighting for OakLand, line numbers, squiggly underlines under the exact span of each diagnostic, shown while typing for syntax errors and after Run for the rest. `Ctrl/Cmd+Enter` runs.
- **AC-27 Output.** Only the program's output.
- **AC-28 Problems.** A list of diagnostics (phase, message, line:column). Clicking one moves the editor to its span.
- **AC-29 AST.** A collapsible tree of the parsed program: node kind and a short summary. Selecting a node highlights its source range in the editor.
- **AC-30 Symbols.** Table of every declared name: name, kind (variable, array, function, struct), type, scope, declaration line/column.
- **AC-31 Trace.** After a run, controls to step forward and back, play/pause, change speed and reset. At each step: the statement being executed is highlighted in the editor; the call stack and the variables of each frame are shown with their values; the changed value is marked; the output printed so far is shown. Recording keeps at most 20,000 steps; past that the run is complete but the trace says it was truncated.
- **AC-32 Examples.** A menu with the programs from `Prueba/`, cleaned and named (basics, control flow, arrays, functions, structs, errors, the diamond figure). One click loads one into the editor. "Open file" and "Save .oak" remain.

## Product quality

- **AC-33** Usable at 375 px wide (the views become tabs) and at 1280 px (editor and views side by side); no horizontal page scroll in either.
- **AC-34** Fully operable with the keyboard; axe reports no serious or critical violations on the main states; text contrast ≥ 4.5:1.
- **AC-35** Lighthouse (mobile, production build): Performance ≥ 90, Accessibility, Best Practices and SEO ≥ 95.
- **AC-36** `npm audit --omit=dev` reports 0 vulnerabilities; a clean clone builds with `npm ci && npm run build`.
- **AC-37** CI on GitHub Actions runs lint, types, unit tests, build and E2E on every push.
- **AC-38** README (English) with screenshots and a live link; `docs/LANGUAGE.md` (reference), `docs/ARCHITECTURE.md`, `CONTRIBUTING.md`, a technical `CLAUDE.md`, and a `LICENSE` file that exists.
- **AC-39** Deployed as a static site on the same URL as today (GitHub Pages).

## Open questions for the approval gate
1. **[Henry?]** `i++`/`i--` as statements and `for` updates only (AC-06). Alternative: also as expressions.
2. **[Henry?]** Struct syntax (AC-18).
3. **[Henry?]** `LICENSE` holder: the file says "HenryQuel (2024)". Keep, or change to your preferred name?
4. **[Henry?]** Repo name stays `OLC2_Proyecto1_202004071` (keeps the live URL). Renaming to `oakland` would be nicer on a CV but changes the URL.
5. Visual direction: decided later, from mockups (approval gate b).
