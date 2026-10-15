# 02 — Technical plan

> Status: **draft for approval.** Each decision lists what was rejected and why. Decisions marked **[Henry?]** change cost or look of the result.

## Shape of the code

```
src/
  core/                    no DOM, runs in Node and in a Worker
    span.ts  diagnostics.ts
    lexer/    tokens.ts  lexer.ts
    parser/   ast.ts  parser.ts  recovery.ts
    interpreter/
      types.ts  values.ts  environment.ts
      interpreter.ts       expressions + statements
      functions.ts  structs.ts  builtins.ts
      limits.ts            step / time / depth / output budgets
      trace.ts             event recorder + snapshots
    symbols.ts  astView.ts   serialisable views of the program
    index.ts               run(source, options) -> RunResult
  worker/   run.worker.ts  client.ts      message protocol, Stop = terminate()
  ui/       App, editor/, panels/ (Output, Problems, Ast, Symbols, Trace), examples/
  examples/ *.oak          cleaned programs from Prueba/
tests/      unit/  golden/  fuzz/  docs/      (Vitest)
e2e/        Playwright + axe
docs/       00..03, LANGUAGE.md, ARCHITECTURE.md, grammar.ebnf, language-changes.md
```

`run(source, options)` returns one plain, serialisable object: `{ stdout, diagnostics, ast, symbols, trace, stats }`. Nothing else crosses the Worker boundary.

## Decisions

**D1 — Hand-written lexer and recursive-descent parser (Pratt for expressions), in TypeScript. [Henry?]**
Why: exact spans on every node (for underlines and AST highlighting), human error messages, panic-mode recovery to report several syntax errors, a token stream reused for editor highlighting, and no generated file in the repo. It also shows the part of compilers that matters most.
Rejected: *keep Peggy.* Least work, but its errors list every expected token, it cannot recover from errors, and the generated 6,000-line `gramatica.js` is the thing a reviewer sees first. *Parser combinators library:* adds a dependency for no gain at this size.
Cost: the grammar is re-implemented. Mitigation: `grammar.ebnf` written first, parser tests per production, golden tests on all samples.

**D2 — Tree-walking interpreter over a discriminated-union AST, completion signals instead of exceptions.**
Statements return a completion (`normal | break | continue | return(value)`) rather than throwing, which is faster and keeps JavaScript exceptions out of normal control flow (principle 2). The old code used generated Visitor classes (whose generator, `tool.js`, is gitignored and missing) and `throw ReturnException`.
Rejected: *Visitor classes* (boilerplate, the generator is gone); *compile to JavaScript with `new Function`* (fast, but hard to trace, cancel and limit, and unsafe by nature); *bytecode VM* (more code than the project needs).

**D3 — Semantics: 32-bit `int` via `| 0` and `Math.imul`; `float` is a JS double printed Java-style; poison value instead of cascades.**
A failed expression yields a *poison* value that makes the enclosing statement report once and skip. This replaces the old `{tipo: null, valor: null}` that leaked into follow-up errors (`int n = 2.5;` used to give two diagnostics).

**D4 — No separate static type-checking pass in v1.**
Types are checked as the program runs, statement by statement, as today. Reason: `Prueba/basicas.oak` deliberately mixes erroneous statements with valid ones and expects the valid ones to run (AC-22). A whole-program checker would either refuse to run them or need the same recovery logic twice.
Rejected: *static checker first, run only if clean.* Cleaner compiler, but breaks the samples' purpose and doubles the type logic. Listed as future work.

**D5 — Trace = event log with checkpoints, recorded during the run, replayed in the UI.**
Each step records `{stmtSpan, frame, changes[], outputLen}`. The UI rebuilds the state at step *k* from the last checkpoint (every 500 steps) plus the diffs, so stepping back is cheap. Array previews are cut at 50 elements. Cap: 20,000 steps, then `truncated: true`.
Rejected: *live stepping with an async interpreter* (every `await` slows the normal run ~10× and complicates every visit function); *full snapshot per step* (memory grows with variables × steps).

**D6 — Off-thread execution: one Web Worker per run, Stop = `worker.terminate()` plus a fresh worker for the next run.**
The step and time budgets live inside the interpreter (they produce a clean diagnostic and keep the output); `terminate()` is the backstop if the interpreter itself ever hangs. Budgets: 2M steps, 5 s, depth 1,000, 200 KB output, 20k trace steps.
Rejected: *main thread with chunked yielding* (complexity, jank); *server-side execution* (breaks principle 9, needs hosting).

**D7 — Editor: CodeMirror 6 with a `StreamLanguage` built on our lexer, `@codemirror/lint` for squiggles, decorations for the current step. [Henry?]**
Rejected: *Monaco* (what the original used): ~5 MB, poor on touch screens, and loaded from a CDN (the page breaks offline).

**D8 — UI: Vite + React 19 + TypeScript strict, plain CSS with custom-property tokens. No Next.js, no Tailwind.**
It is one client-side page with no routing or server rendering. React keeps the panel state manageable and matches Henry's other projects.
Rejected: *vanilla DOM* (the trace player and panels are state-heavy); *Next static export* (a framework with nothing to do here).

**D9 — Tests, in layers.**
- *Unit* (Vitest): lexer, each parser production, each operator and statement, each built-in.
- *Characterisation first*: before touching anything, run the original interpreter (`11b0e46`) on the seven programs and save output to `tests/golden/legacy/`. The new interpreter's outputs are compared with them; every difference is written in `docs/language-changes.md`.
- *Golden*: new expected outputs for every example program.
- *Doc tests*: every ```` ```oak ```` block in `docs/LANGUAGE.md` is run, with its expected output in a comment.
- *Fuzz*: 1,000 seeded mutations (delete/duplicate/swap tokens and lines) of the samples; `run()` must always return, never throw.
- *E2E* (Playwright + axe, 1280 px and 375 px): run an example, see output, click a problem, step the trace, Stop an infinite loop, keyboard-only path.

**D10 — Deployment: GitHub Pages through a GitHub Actions workflow; Vite `base` set to the repo path. [Henry?]**
Keeps `https://henryd11703.github.io/OLC2_Proyecto1_202004071/`. Henry has to switch Pages → Source → "GitHub Actions" once in the repo settings.
Rejected: *Vercel* (also fine; new URL, no benefit here). *Rename repo to `oakland`* (nicer on a CV, but changes the URL; can be done later).

**D11 — Names and messages in English.** Node kinds, files, diagnostics, UI. The language itself keeps its keywords and its Spanish-named built-in `obtenerLongitudArray`. Old Spanish docs (`Reportes/ManualTecnico.md`, old README) are replaced; the old files stay in git history, and the original program `.txt` files move to `examples/` renamed.

**D12 — Design.** Own identity, Swiss influence, not the VS Code clone. Three mockup directions are shown to Henry before any UI is built (approval gate b). Nothing visual is decided in this document.

## Risks
- **Parser rewrite drifts from the old language.** Mitigation: legacy golden outputs from day one; every difference reviewed.
- **Trace volume.** Mitigation: caps, checkpoints, array preview limit; test with the diamond sample (largest loop).
- **Java semantics change some old output** (`5` → `5.0`, `7/2`). Mitigation: all deltas listed and shown to Henry before merging.
- **Editor on touch devices.** Mitigation: CodeMirror 6 plus an E2E at 375 px.
- **Unverified today:** the original UI in a browser, and real timing of the Worker on a low-end phone. Both are measured during the work, not assumed.
