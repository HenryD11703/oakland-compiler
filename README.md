# OakLand

**A small Java-like language, and an interpreter you can watch run.**

Write a program, press Run, then drag through its execution: the line being run, every variable, the call stack, the output so far and the syntax tree, at any of up to 20,000 recorded steps. Everything runs in your browser; nothing is sent anywhere.

**Live:** deployed on Vercel (the link goes here after the first deploy).

![The playground midway through a run: source with values at the ends of lines, variables, output, and a timeline of the whole run](docs/images/playground.png)

OakLand began as a university project for the compilers course (OLC2, USAC): an interpreter with a Peggy-generated parser and a Monaco editor. This version is a rebuild: a hand-written lexer and parser, a tree-walking interpreter with Java-like semantics, a recorded trace, and an interface made to explain what a program does.

## What you can do

- **Step through a run.** The timeline at the bottom is drawn from the whole trace: the line that was running, which conditions held, what had been printed, and the values of the numeric variables that change most. Drag it, or use the arrow keys (`Shift` for 100 steps, `Home`/`End`).
- **See the call stack.** Recursion shows one frame per call, with the variables of each; the line that made a call is marked again when the call returns.
- **See values next to the code.** Each line that assigns a variable shows its current value at the end of the line.
- **Read mistakes, not stack traces.** Every problem (syntax, types, names, arguments, bounds, division by zero, runaway loops) is a message with a line and column, underlined in the editor and listed under *Problems*. A bad program never crashes the page.
- **Look inside.** *Syntax tree* draws how the interpreter parsed the program as a tree (fold any node, zoom, open it as a whole view from the top bar), *Symbols* lists every name it declares; clicking either jumps to the source.
- **Arrange the panels.** Drag the dividers (or focus one and use the arrow keys) to give the code, the variables or the output more room; the sizes are remembered. The page is dark.
- **Compile it.** The mode switch next to *Examples* turns the page into a compiler: your source on the left, the **WebAssembly** it became on the right, one foldable block per function (a function of yours points at the source lines it came from, and a click in the source opens its function). The numbers of the module (bytes, time to compile, time to run) take the place of the timeline, and **Compare** runs both modes on the same program: two bars on a scale where each step is ten times more, the ratio, and whether the outputs are identical. A compiled program that never ends is stopped by **Stop** or after five seconds.
- **Try examples** (Hello, Basics, Control flow, Arrays, Functions, Sieve, Structs, Animals, Bank account, Linked list, Heart, Mistakes), open a `.oak` file, or save yours.

| Mistakes with their positions | A recursive call stack | On a phone (375 px) |
|---|---|---|
| ![](docs/images/mistakes.png) | ![](docs/images/call-stack.png) | ![](docs/images/phone-code.png) |

## The language

Static types (`int`, `float`, `string`, `boolean`, `char`, arrays and matrices of any depth, structs), functions with recursion, **classes** (fields, constructors, methods, single inheritance, overriding, `private`), `if`/`while`/`for`/for-each/`switch`. `int` is 32-bit, floats print like Java, and strings join with anything.

```java
struct Person { string name; int age; }

int factorial(int n) {
    if (n == 0) { return 1; }
    return n * factorial(n - 1);
}

Person ana = Person{name: "Ana", age: 20};
ana.age++;
System.out.println(ana.name, "is", ana.age, "and 5! is", factorial(5));
```

The full reference is [`docs/LANGUAGE.md`](docs/LANGUAGE.md). **Every example in it is run by the test suite**, so it cannot drift from the interpreter. The grammar is [`docs/grammar.ebnf`](docs/grammar.ebnf), and what changed from the original course interpreter, line by line, is [`docs/language-changes.md`](docs/language-changes.md).

## How fast

The page runs programs with the interpreter, and, in **Compile** mode, with a **compiler to WebAssembly** (`src/core/compile/`): the same programs, checked by the same type checker, turned into a module the browser runs natively. These are the numbers of the engine, measured with `npm run bench` (Node) and `npm run bench:browser` (Chromium); the page's Compare shows the same thing for any program, one run of each. Both check that the two modes print the same text before they time anything.

**Node 22.23.3** on an Intel Core i3-9100F @ 3.60 GHz (4 threads, 8 GiB), WSL2 on Windows, 2026-10-18. Median of 5 runs after a warm-up, times in milliseconds.

| Program | Original | Interpreter, with trace | Interpreter, no trace | Compiled | Faster | Compile | Module (bytes) |
|---|---:|---:|---:|---:|---:|---:|---:|
| fib: recursive `fib(25)`, 250,000 calls | 1,685 | 345 | 304 | 0.9 | 337× | 1.0 | 296 |
| loop: a million iterations of integer arithmetic | 393 | 2,444 | 2,118 | 5.9 | 358× | 1.0 | 198 |
| sieve: primes up to 200,000 | n/a | 1,253 | 1,270 | 4.2 | 302× | 1.1 | 586 |
| matrix: two 80 × 80 matrices multiplied | 1,438 | 1,553 | 1,518 | 6.8 | 223× | 2.0 | 1,175 |
| fields: 300,000 method calls on a class | n/a | 992 | 879 | 3.9 | 226× | 2.1 | 1,062 |
| objects: 300,000 virtual calls | n/a | 1,356 | 1,248 | 7.5 | 166× | 2.5 | 1,672 |
| strings: 100,000 short strings and one long one | n/a | 307 | 274 | 15.6 | 18× | 1.4 | 1,025 |

**Chromium 156** (headless, through Playwright) on the same machine, same method:

| Program | Interpreter, no trace | Compiled | Faster | Compile | Module (bytes) |
|---|---:|---:|---:|---:|---:|
| fib | 241 | 0.9 | 268× | 0.9 | 296 |
| loop | 1,738 | 5.1 | 341× | 1.0 | 198 |
| sieve | 862 | 4.3 | 200× | 1.4 | 586 |
| matrix | 1,067 | 7.5 | 142× | 1.9 | 1,175 |
| fields | 599 | 1.4 | 428× | 1.9 | 1,062 |
| objects | 836 | 2.4 | 348× | 1.8 | 1,672 |
| strings | 200 | 12.2 | 16× | 3.7 | 1,025 |

How to read them honestly:

- **"Faster" is against this rebuilt interpreter, which does a lot of work the compiled code does not**: it checks types, counts steps against limits, keeps scopes with positions and records a trace so the page can replay a run. The **original** course interpreter, which did none of that, was faster than the rebuilt one on simple loops (393 ms against 2,118 ms on `loop`) and slower on recursion (1,685 ms against 304 ms on `fib`). It could not run the programs marked n/a (older syntax, no arrays of that kind, no classes).
- The speed-up is smallest where the work is in strings (16–18×): building a string copies it, and turning a float into text is done by the browser, not by the module.
- Compiling takes 1 to 4 ms for these programs, and the modules are 0.2 to 1.7 KB.
- One machine, one run of the script, a desktop CPU. Nothing here was measured on a phone. A compiled run has no step counter, so a program that never ends is stopped from outside (the Worker), not by a limit.
- Memory in a compiled run is a bump allocator that never frees: a program that keeps allocating ends with `out of memory` at 256 MiB, which the interpreter does not.

## Run it yourself

```bash
npm ci
npm run dev        # http://localhost:5173
npm run check      # lint + types + unit tests
npm run test:e2e   # builds, serves and tests the page in Chromium (desktop and phone, with axe)
npm run build
npm run bench          # interpreter and compiler on the programs in bench/ (Node)
npm run bench:browser  # the same inside Chromium (needs: npx playwright install chromium)
```

Node 20.19 or newer. Nothing else: no backend, no Docker, no environment variables.

## How it is built

```
src/core/       the interpreter (lexer, parser, tree-walking interpreter, trace, symbols), the static type
                checker (check/) and the compiler to WebAssembly (compile/). No DOM.
src/worker/     runs a program in a Web Worker (interpret, compile or compare); Stop ends the worker
src/ui/         React interface, CodeMirror 6 editor, timeline
src/examples/   the twelve example programs (English)
docs/           principles, spec, plan, tasks, language reference, design notes
tests/ e2e/     unit, golden, fuzz and documentation tests; Playwright end-to-end tests
```

The design decisions, and the alternatives that were rejected, are in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md); the compiler, from a line of source to its bytes, is in [`docs/COMPILER.md`](docs/COMPILER.md). The project was written spec-first: [principles](docs/00-principles.md), [spec](docs/01-spec.md) with 39 measurable acceptance criteria, [plan](docs/02-plan.md) and [tasks](docs/03-tasks.md), which ends in a table mapping each criterion to the test that checks it.

## Testing

- **About 1,600 unit tests** (the number is whatever `npm run check` prints): lexer, parser (with a corpus of syntax errors and their exact positions), every operator and statement, structs, classes (objects, inheritance, virtual calls, private, 50 class mistakes), built-ins, limits, the trace and its replay, the symbol table, the timeline data.
- **Golden files** pin the output of the seven original course programs, and the way it differs from the original interpreter's (`tests/golden/legacy-diff/`). The course's own hand-written expected outputs are checked too.
- **Fuzzing**: 1,000 mutations of the samples and 500 token soups, seeded, must never make `run()` or `compile()` throw, and every module the compiler returns must validate. (One-off runs of 20,000 cases found no exception.)
- **Two modes, one answer**: every program of the corpus, and 200 generated well-typed programs, are run interpreted and compiled and must print the same text and meet the same first mistake. Eight deliberately broken compilers (one instruction swapped for another) must each be caught by those same programs. Six small programs have their WebAssembly committed as golden files, and the worked example of `docs/COMPILER.md` is compiled by a test.
- **About 80 end-to-end tests** (on a desktop and on a phone viewport) with axe accessibility scans of every panel: Stop on a runaway loop, jumping from a problem to its line, stepping by keyboard, opening and saving files, and Compile mode (pick Sieve, Compile, read the WebAssembly, Compare; a compiled infinite loop ended by Stop and by the five-second limit).

## Honest limits

- **Recursion is limited to 400 nested calls** (Java allows thousands), in both modes and with the same message. The interpreter uses the JavaScript stack, which gives out first; a recursive sum up to 1000 does not fit.
- A run is bounded: 20 million steps, 5 seconds, 200,000 characters of output, 1,000,000 elements per array. Past that it stops with a diagnostic and keeps its output.
- The trace records up to 20,000 steps; longer runs complete but the timeline says it was cut.
- Lighthouse on a simulated slow phone: Performance 82–100 across runs (median 83); Accessibility, Best Practices and SEO 100. Desktop preset: 93.

## License

MIT. The language and the original interpreter come from a university course project; this rebuild is by Henry Quel.
