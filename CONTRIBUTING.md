# Contributing

## Set up

```bash
npm ci
npx playwright install chromium     # only for the end-to-end tests
npm run check                       # lint, types, unit tests: run this before every commit
npm run dev
```

## Rules that do not bend

They are in [`docs/00-principles.md`](docs/00-principles.md). The ones you will meet most often:

1. `src/core` is plain TypeScript: no DOM, no browser globals. Lint will tell you.
2. **`run()` must never throw.** A mistake in a program becomes a diagnostic with a position, never an exception.
3. What the program prints and what the interpreter says about it are different things (stdout and diagnostics).
4. Every claim is a test: an acceptance criterion in `docs/01-spec.md` needs a test, and an example in `docs/LANGUAGE.md` is run by one.

## Common changes

**A new example program.** Add `src/examples/name.oak` (in English), register it in `src/examples/index.ts`, and add it to `tests/unit/examples.test.ts` (it must run with no diagnostics, or list the ones it shows on purpose).

**A language change.**
1. Write the rule in `docs/LANGUAGE.md` with an example (`oak` block, then an `output` block, then optionally `problems`).
2. Change the lexer, parser or interpreter; add unit tests next to the ones for that feature.
3. Run `npm test`. If a golden file changes, read the diff; if it is intended, accept it with `npx vitest run -u` and explain the change in `docs/language-changes.md`.

**A new built-in function.** Add it to `src/core/interpreter/builtins.ts`, test it in `tests/unit/interpreter-functions.test.ts`, list it in `docs/LANGUAGE.md`.

**A change to the interface.** Keep it usable at 375 px and from the keyboard. `npm run test:e2e` runs axe on every panel; it must stay at zero violations. Kill anything on port 3100 first, or Playwright may serve a stale build.

## Commits

One logical change per commit, a subject in the imperative, and a body that says *why* when it is not obvious. Do not commit secrets (there are none in this project) or generated folders (`dist`, `test-results`).

## Reporting a problem in the language

If OakLand prints something different from what Java would, say what you expected and why. Several rules (integer division, string comparison, 32-bit overflow) follow Java on purpose; the exceptions are listed in `docs/language-changes.md`.
