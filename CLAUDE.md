# CLAUDE.md: OakLand

Technical guide for an AI (or a person) working in this repository. Written for the next session: read it before changing anything.

## What this is
OakLand, a Java-like language with an interpreter you can watch run and a compiler to WebAssembly you can read (React + TypeScript + Vite, CodeMirror 6, a Web Worker). A rebuild of a university compilers project. User-facing description: `README.md`. Why it is built this way: `docs/ARCHITECTURE.md`. How the compiler works, from a line of source to its bytes: `docs/COMPILER.md`. The spec-first documents: `docs/00-principles.md`, `01-spec.md`, `02-plan.md`, `03-tasks.md` (its last table maps each criterion to a test).

## Commands
```bash
npm run check          # eslint + tsc + vitest (about 1,600 tests, about 15 s). Run before every commit, and WAIT for it: `npm run check && git commit`.
npm test               # vitest only
npm run test:e2e       # builds, serves on :3100, Playwright (desktop + phone, axe). Needs: npx playwright install chromium
npm run build          # tsc --noEmit && vite build; the site is served from the root (`/`)
npm run screenshots    # README images; needs `vite preview --port 3100 --strictPort` running
npm run capture-legacy # regenerates tests/golden/legacy from git commit 11b0e46 (the original interpreter)
npm run bench          # interpreter vs compiler on bench/*.oak, in Node; npm run bench:browser does it in Chromium
npx tsx scripts/mockup-compiler-data.ts && node scripts/mockup-compiler-shots.mjs   # the Compile-mode mockups of docs/design/compiler/
```
Update golden snapshots after an intended change: `npx vitest run -u`, then read the diff (that includes `tests/golden/wat/`: the WebAssembly of six programs).

## Map
- `src/core/` the interpreter. **No DOM**: lexer, parser (`parser/ast.ts` is the AST; classes are `ClassDecl`), `interpreter/` (values, environment, builtins, limits, placement; classes, objects and virtual calls live in `interpreter.ts`: `declareClasses`, `construct`, `callMethod`), `trace/` (recorder, replay, series), `classes.ts` (the class table shared by the interpreter and the checker), `check/` (the static type checker: `check(program)` types every expression and finds mistakes without running; used by Compile mode and, for the type of `a ? b : c`, by the interpreter), `types.ts`, `symbols.ts`, `astView.ts`, `run.ts` (the one entry point), and `compile/` (the compiler: `lower.ts` the checked tree → the IR in `ir.ts`; `encode.ts` the bytes and `wat.ts` the text, both from the same IR; `runtime.ts` the allocator, strings and arrays written in the IR; `host.ts` the imports and the table of places that can fail; `index.ts` `compile()` and `runCompiled()`, neither of which throws).
- `src/worker/` protocol (three requests: `run`, `compile`, `compare`), handler (pure, tested), worker, client (Stop, the hard timeout: 12 s, and 5 s for a compiled program).
- `src/ui/` `App.tsx` (state and layout; the mode switch is `mode`), `Editor.tsx` (CodeMirror), `Timeline.tsx` + `timelineData.ts`, `Panels.tsx`, `SyntaxTree.tsx` (the tree drawn as a tree), `CompiledPanel.tsx` (the WebAssembly, foldable by function), `CompileBar.tsx` (the ledger and the Compare chart), `inlineValues.ts`, `styles.css`.
- `tests/unit`, `tests/golden` (`legacy/` original output, `current/` snapshots, `legacy-diff/`, `wat/` the WebAssembly of six programs), `tests/fixtures/prueba` (the seven original programs, never edit), `tests/fuzz`, `tests/docs` (the examples of `LANGUAGE.md` and the worked example of `COMPILER.md` are run); `tests/helpers/` (`differential.ts`: `compareModes`, the check that both modes agree; `generate.ts`: the seeded generator of programs; `mutants.ts`: deliberately broken compilers; `minimise.ts`; `fuzz.ts`); `e2e/` (`app.spec.ts`, `compile.spec.ts`).
- `docs/design/` three mockups of the interpreter page, the choice made (`01-chosen-direction.md`), generated `mockups/data.js` (`npx tsx scripts/mockup-data.ts`); `compiler/` the three mockups of Compile mode and the choice (B with C's chart; `00-directions.md`). `docs/stage-2/` the spec, plan and tasks of the compiler stage (the last table of `03-tasks.md` maps each criterion to a test).

## Rules
1. `run()` never throws; a user's mistake is a diagnostic. A fuzz test enforces it.
2. `src/core` imports nothing from `ui`/`worker` and uses no browser globals.
3. Output (`stdout`) and diagnostics are separate. The same mistake at the same place is listed once; at most 200 are listed.
4. The seven fixture programs must keep running; their course-written expected outputs are tested (`samples-run.test.ts`). Any change to what they print is explained in `docs/language-changes.md`.
5. Messages and UI are in English. Spanish appears only in the fixtures and in the built-in `obtenerLongitudArray`.
6. The "end" step of a trace has no source line; do not highlight it.
7. **The interpreter is the oracle of the compiler.** When the two differ, the interpreter is right unless the spec says otherwise (`docs/language-changes.md`, "Stage 2: the compiler"). `compile()` and `runCompiled()` never throw; a compiled program that fails ends with the interpreter's words at the interpreter's place.
8. A new construct of the language is not finished until it is in the checker, the interpreter **and** the compiler, in `LANGUAGE.md` with an executable example, and in the generator (`tests/helpers/generate.ts`) if it can be generated.

## Things that cost time before
- **Do not run `python3`** (or `python -`) in the shell: on this Windows setup it waits for input and blocks 30 s. Use Node for scripts.
- **Chromium on WSL without `sudo`:** Playwright's Chromium needs `libnspr4`, `libnss3` and `libasound2t64`. `apt-get download` them into a scratch folder, `dpkg -x` each `.deb` there, and run with `LD_LIBRARY_PATH=<folder>/usr/lib/x86_64-linux-gnu`. Then `npm run test:e2e` and `npm run screenshots` work locally.
- Long heredocs with quotes inside `Bash` sometimes fail to parse; write scripts with the file-writing tool and run them.
- Kill whatever listens on port 3100 before `npm run test:e2e`; `reuseExistingServer` is off, and a stale `vite preview` serves an old build.
- `vite preview` needs the production `base`; `vite.config.ts` handles it (`isPreview`).
- JavaScript stack depth depends on how warm the engine is. Never write a test that depends on being close to the recursion limit (400 calls).
- CodeMirror on an Android-emulated browser does not fire `Mod-Enter`; mobile E2E tests use the Run button.
- Lighthouse is bimodal on this page (82–100 mobile between identical runs); take three and report all of them.
- `.cm-*` styles need the `.cm-editor` prefix to beat CodeMirror's own theme.
- `React` lint (`react-hooks`) rejects state updates directly inside effects and ref reads during render; the code is arranged around that.
- **Do not give `tsx` code to time**: `tsx` adds helper functions to every closure and makes the interpreter 2 to 3 times slower than it is. `npm run bench` builds the core with Vite first. (`__name is not defined` in a function sent to Playwright is the same helper; `bench-browser.ts` defines it in the page.)
- **Do not write a `.replace(...)` to fix the text of a test program**; write the program right.
- A **mutant** of the compiler (`tests/helpers/mutants.ts`) can make a loop that never ends; every loop of a mutant spends fuel and traps. Keep that when adding mutants.
- The tests that wait for a runaway loop to hit its limit (`while (true) { }`) are the slowest and fail by timeout when the machine is busy: run again before looking for a bug.
- A `print` that is `time()` can never be compared across runs; the differential checks skip it on purpose.
- A trace event in a *deferred* position (parameters) is applied at the start of the next step on purpose; see `trace/recorder.ts`.

## Git
Identity is local to the repository (`git config --local`), `HenryD11703 <3680558330101@ingenieria.usac.edu.gt>`. Never `--global`, never `-c user.*`. Work on a branch (`feat/revamp`), never on `main`. Pushing, opening a PR, tagging, or changing the Pages settings needs the owner's OK each time.

## Deploy
`.github/workflows/ci.yml` runs on every push (check, build, audit, E2E). The site is deployed by **Vercel** straight from `main` (framework Vite, build `npm run build`, output `dist`; see `vercel.json`); there are no environment variables.
