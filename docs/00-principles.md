# 00 — Principles

Rules that do not bend. If a task needs to break one, the task changes, not the rule.

1. **The interpreter is a library, not a page.** Everything under `src/core/` is plain TypeScript with no DOM, no `window`, no `fetch`. It runs the same in Node (tests) and in the browser (Worker). The UI only reads what the core returns.
2. **A bad program never crashes the host.** Every mistake a user can make in OakLand (syntax, types, undeclared names, bad arguments, array bounds, runaway loops) produces a *diagnostic* with a position. A JavaScript exception escaping `run()` is a bug in the interpreter, always.
3. **Output and diagnostics are different streams.** What the program prints is stdout. Everything the interpreter has to say about the program is a diagnostic. They are never mixed in one string.
4. **Execution is bounded and cancellable.** A run has limits (steps, time, call depth, output size) and a Stop button, and it happens off the main thread. No program can freeze the page.
5. **The interpreter shows its work.** Trace events, the AST and the symbol table are first-class results of `run()`, designed in from the start, not scraped from internal state afterwards.
6. **The language is specified by examples.** Every claim in the language reference is a code block that a test executes. Every acceptance criterion in `01-spec.md` maps to at least one test.
7. **The old programs keep working.** Everything in `Prueba/` runs. Any change in what they print is listed in `docs/language-changes.md` with the reason. Nothing changes silently.
8. **Java-like where in doubt.** OakLand has no official spec any more, so doubtful rules (integer division, overflow, string comparison) follow Java. The syntax stays as it is, plus `++` and `--`, and nothing more.
9. **Static site, nothing leaves the browser.** No backend, no account, no analytics, no secrets.
10. **English everywhere users and contributors read** (UI, code, diagnostics, docs). Own visual identity: no generic AI look (no gradients, no purple, no rounded-card soup).
