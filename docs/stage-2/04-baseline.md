# Stage 2 — Baseline: how fast the interpreter is today (T30)

Measured with `npm run bench` on **Node v22.23.3, Intel Core i3-9100F @ 3.60 GHz (4 threads)**, median of 5 runs after one warm-up. The programs are in `bench/`. The core is built with Vite first, as the site is (see "A measurement trap" below).

| Program | What it does | Interpreter, with trace (ms) | Interpreter, no trace (ms) | Steps |
|---|---|---:|---:|---:|
| `loop` | 1,000,000 iterations of integer arithmetic | 2,101 | 1,989 | 16,000,010 |
| `fib` | recursive Fibonacci, `fib(25)`, about 250,000 calls | 294 | 247 | 2,549,243 |
| `sieve` | sieve of Eratosthenes to 200,000 (arrays, nested loops) | 1,068 | 1,015 | 9,048,987 |
| `fields` | 300,000 method calls on a class, each reading and writing two fields | 875 | 790 | 5,400,014 |

The fourth program was a struct loop (515 ms with trace, 484 ms without, 5,100,016 steps) until T48, when classes became compilable; it is now a method-call loop on a class, measured on 2026-10-17.

## What this answers

- **The trace is not the main cost.** Recording it adds about 4 to 20 % (8 % on the loop). The interpreter is slow for another reason: it evaluates about 16 steps per iteration of a simple loop, at about 125 ns a step.
- **The rebuilt interpreter is slower than the course interpreter** on the same loop: about 2.0 s against about 0.4 s measured on the original (commit `11b0e46`, run in Node on 2026-10-14). The rebuild checks types, counts steps against limits, keeps scopes with positions and records a trace; the original did none of that. This is a number to keep in mind when the compiled speed-up is reported: it is measured against *this* interpreter, and the README says so.
- A compiled loop of a million iterations should take single-digit milliseconds, so the ratio will be large whatever the cause. That is why the README reports all three numbers (original, rebuilt, compiled) and not only the flattering one.

## A measurement trap

The first version of the benchmark ran the TypeScript through `tsx` and reported 4.5 s for the loop. A CPU profile showed 48 % of the time in `__name` and `TextDecoder`, helpers that esbuild's `keepNames` adds to every closure the interpreter creates. Built the way the site is built, the same loop takes 2.0 s. The script now builds the core with `vite build --ssr` before measuring. The earlier "4.8 s" in the notes of 2026-10-15 was this artefact, not the interpreter.

## Not measured yet

Browser timings (the Worker on a desktop and on a phone). T54 measures them and labels them.
