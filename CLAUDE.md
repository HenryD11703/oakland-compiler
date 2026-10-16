# CLAUDE.md: OakLand

Technical guide for an AI (or a person) working in this repository. Written for the next session: read it before changing anything.

## What this is
OakLand, a Java-like language with an interpreter you can watch run (React + TypeScript + Vite, CodeMirror 6, a Web Worker). A rebuild of a university compilers project. User-facing description: `README.md`. Why it is built this way: `docs/ARCHITECTURE.md`. The spec-first documents: `docs/00-principles.md`, `01-spec.md`, `02-plan.md`, `03-tasks.md` (its last table maps each criterion to a test).

## Commands
```bash
npm run check          # eslint + tsc + vitest (about 870 tests, about 10 s). Run before every commit.
npm test               # vitest only
npm run test:e2e       # builds, serves on :3100, Playwright (desktop + phone, axe). Needs: npx playwright install chromium
npm run build          # tsc --noEmit && vite build; the site is served from the root (`/`)
npm run screenshots    # README images; needs `vite preview --port 3100 --strictPort` running
npm run capture-legacy # regenerates tests/golden/legacy from git commit 11b0e46 (the original interpreter)
```
Update golden snapshots after an intended change: `npx vitest run -u`, then read the diff.

## Map
- `src/core/` the interpreter. **No DOM**: lexer, parser (`parser/ast.ts` is the AST; classes are `ClassDecl`), `interpreter/` (values, environment, builtins, limits, placement; classes, objects and virtual calls live in `interpreter.ts`: `declareClasses`, `construct`, `callMethod`), `trace/` (recorder, replay, series), `symbols.ts`, `astView.ts`, `run.ts` (the one entry point).
- `src/worker/` protocol, handler (pure, tested), worker, client (Stop, hard timeout).
- `src/ui/` `App.tsx` (state and layout), `Editor.tsx` (CodeMirror), `Timeline.tsx` + `timelineData.ts`, `Panels.tsx`, `inlineValues.ts`, `styles.css`.
- `tests/unit`, `tests/golden` (`legacy/` original output, `current/` snapshots, `legacy-diff/`), `tests/fixtures/prueba` (the seven original programs, never edit), `tests/fuzz`, `tests/docs`; `e2e/`.
- `docs/design/` three mockups, the choice made (`01-chosen-direction.md`), generated `mockups/data.js` (`npx tsx scripts/mockup-data.ts`).

## Rules
1. `run()` never throws; a user's mistake is a diagnostic. A fuzz test enforces it.
2. `src/core` imports nothing from `ui`/`worker` and uses no browser globals.
3. Output (`stdout`) and diagnostics are separate. The same mistake at the same place is listed once; at most 200 are listed.
4. The seven fixture programs must keep running; their course-written expected outputs are tested (`samples-run.test.ts`). Any change to what they print is explained in `docs/language-changes.md`.
5. Messages and UI are in English. Spanish appears only in the fixtures and in the built-in `obtenerLongitudArray`.
6. The "end" step of a trace has no source line; do not highlight it.

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
- A trace event in a *deferred* position (parameters) is applied at the start of the next step on purpose; see `trace/recorder.ts`.

## Git
Identity is local to the repository (`git config --local`), `HenryD11703 <3680558330101@ingenieria.usac.edu.gt>`. Never `--global`, never `-c user.*`. Work on a branch (`feat/revamp`), never on `main`. Pushing, opening a PR, tagging, or changing the Pages settings needs the owner's OK each time.

## Deploy
`.github/workflows/ci.yml` runs on every push (check, build, audit, E2E). The site is deployed by **Vercel** straight from `main` (framework Vite, build `npm run build`, output `dist`; see `vercel.json`); there are no environment variables.
