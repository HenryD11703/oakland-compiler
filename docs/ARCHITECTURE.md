# Architecture

How OakLand is put together, and why. The decisions were made before the code (see [`02-plan.md`](02-plan.md)); this page says what stood, what changed while building, and what was measured.

## The shape

```
source text
   │
   ▼  src/core/lexer        tokens with exact positions (also used to colour the editor)
   ▼  src/core/parser       recursive descent + Pratt: a typed AST with a span on every node,
   │                        up to 10 syntax errors per run (panic-mode recovery)
   ▼  src/core/interpreter  tree walk; completions instead of exceptions; "error" values so one mistake
   │                        gives one diagnostic; limits (steps, time, depth, output, array size)
   ▼  src/core/trace        a recorder inside the interpreter; a replayer that rebuilds any step
   ▼  src/core/run.ts       run(source) → { stdout, diagnostics, ast, symbols, trace, ... }  plain data

src/worker/   one Web Worker per run; the result is posted back (plus the numeric series for the timeline
              and the state of the last step); Stop terminates the worker
src/ui/       React + CodeMirror 6; reads the result, never touches the interpreter
```

`src/core` has **no DOM, no `window`, no `fetch`** (an ESLint rule enforces it). It runs the same in Node (all the tests) and in the Worker.

## Decisions, and what was rejected

| Decision | Why | Rejected |
|---|---|---|
| Hand-written lexer and parser in TypeScript | exact spans on every node (squiggles, tree highlighting), readable messages, recovery that reports several errors, the token stream reused for colouring, no 6,000-line generated file | keeping Peggy (its errors list every expected token and it cannot recover) |
| Tree-walking interpreter over a discriminated-union AST, with *completion values* (`normal`, `break`, `continue`, `return`) | no JavaScript exceptions in normal control flow; simple to trace | generated Visitor classes (their generator was lost), compiling to JavaScript with `new Function` (hard to trace, cancel and limit), a bytecode VM |
| An `ERROR` value that makes every enclosing operation stay silent | one mistake gives one diagnostic; the course sample expects a failed store to leave `null` | reporting every follow-up error |
| Types and names are checked while running, not in a separate pass | the course's sample programs mix mistakes with code that must still run | a static checker first (cleaner, but it would refuse those programs) |
| Trace = steps with events and a shared heap, recorded during the run, replayed in the page | cheap to record, back-stepping is cheap with checkpoints every 500 steps | an async interpreter for live stepping (every `await` slows the run), a full snapshot per step (memory grows with steps × variables) |
| A Web Worker per run, Stop = `terminate()` | the page can never freeze; the limits inside the interpreter give clean diagnostics, `terminate()` is the backstop | running on the main thread in chunks |
| CodeMirror 6, coloured by the interpreter's own lexer | light (the editor chunk is 99 KB gzipped), works on touch screens, no CDN | Monaco (what the original used: about 5 MB, poor on phones) |
| Vite + React, plain CSS, fonts bundled | one client-side page; works offline once loaded; nothing leaves the browser | Next.js, Tailwind, Google Fonts |
| Vercel, from `main` | Henry's other projects are there; no workflow to maintain; the base path is `/` | GitHub Pages (needs a workflow and a path-prefixed base; it was the first plan) |

## The trace

One **step** is recorded for each statement that runs, each condition that is evaluated (with its result), each for-each iteration, and each return to the line that made a call. A step holds the events it caused: a variable declared or changed, an array element or struct field changed, a frame or scope opened or closed. Arrays and structs live on a **heap** of their own, referred to by id, so two variables holding the same array show the same contents.

Scope and frame changes take effect at the *start of the next step*, so the variables of a block are still visible while its last statement is highlighted. The recorder keeps at most 20,000 steps, and the first 100 items of an array (its length is always exact).

`TraceReplayer.stateAt(k)` rebuilds the state at any step in either direction, starting from the nearest checkpoint. A test replays every sample forwards, backwards and in random order and requires identical states.

## Numbers that were measured, not assumed

- **Speed:** about 2 million interpreter steps take 0.1–0.3 s in Node, so the step limit is 20 million; in a browser the 5-second limit usually binds first.
- **Recursion depth:** with cold processes the JavaScript stack gives out at roughly 800 simple calls and about 450 calls that nest blocks. The limit is 400, so the clear message always comes first. (A depth test once passed only because the engine had warmed up; tests no longer depend on being near the stack limit.)
- **Payload:** the heart program (13,228 steps) is a 1.8 MB message from the worker; deserialising it takes 25 ms in Node.
- **Lighthouse (production build):** see the README.

## Testing layers

1. **Unit**: lexer, parser, interpreter by feature, trace, symbols, UI data (`tests/unit`).
2. **Characterisation**: before anything was changed, the original interpreter's output for the seven course programs was captured from git (`scripts/capture-legacy.mjs`); the new output is compared with it and every difference is explained in `language-changes.md`.
3. **Golden**: file snapshots of every sample's output and diagnostics.
4. **Fuzz**: seeded mutations; `run()` must return, with sound spans, every time.
5. **Documentation tests**: every example in `LANGUAGE.md` is executed.
6. **End to end**: Playwright at 1280 px and 375 px, with axe.

## What is not here

Live (breakpoint-style) debugging, a static type checker, sharing programs by link, a dark theme, localisation. See `01-spec.md`, "Out".
