# Stage 2 — The type checker (Phase B)

`check(program)` in `src/core/check/` reads a parsed program and works out the type of every expression **without running it**. A program with no diagnostics is one the compiler (Phase C) can translate: every name is declared, every operation has operands it accepts, a number is never read before it has a value, and a function returns on every path.

It never throws, and it returns `{ diagnostics, types, classes }`: the mistakes sorted by position, the static type of every expression it looked at (`error` when the expression was wrong, so one mistake is reported once and does not cascade), and the table of classes.

Two modules are shared with the interpreter, so that the two cannot disagree: `src/core/types.ts` (the rules of types: assignability, numeric types) and `src/core/classes.ts` (whether a class declaration is acceptable: parents, cycles, duplicates, overrides, `super(...)`).

## What it checks

- Every expression has a type: literals, names (variables, parameters, fields of `this`), operators, the ternary, assignment (`=`, `+=`, `-=`), indexing, members, calls (functions, methods, `super.method()`, built-ins, array methods), `new`, struct literals, `this`.
- Declarations: unknown types, duplicates, `var` from `null`, array lists of values, struct fields.
- Statements: boolean conditions, for-each over an array, comparable `switch` cases, `++` and `--` on numbers.
- **Definite assignment (S-13).** An `int`, `float`, `boolean` or `char` that is read before it is certain to hold a value is a mistake. Strings, arrays, structs and objects start as `null` and need no assignment. The analysis follows `if`/`else`, loops (an assignment inside a loop does not count after it), `switch` (every case, and a `default`), the ternary, and `return`/`break`/`continue`, which leave a path. A variable of an outer function is not followed across a call.
- **Return on every path.** A function that is not `void` must end in a `return`, an infinite `while (true)` with no `break`, or a branch that does. Reported at the name of the function.
- **Classes**: everything in `docs/LANGUAGE.md`, "Class mistakes", at the place the code is written, whether or not anything runs it.
- `break`, `continue`, `return` and `super(...)` out of place (the same check the interpreter makes before it runs, `placement.ts`).

## Where it differs from the interpreter, on purpose

The interpreter stays tolerant (Interpret mode): it finds mistakes while running and goes on. The checker is for Compile mode, so it is stricter in a few places where a compiled program has no way to be as forgiving.

| What | Interpreter | Checker | Why |
|---|---|---|---|
| `int n;` and then reading `n` | holds `null`, prints `null` (AC-08) | a mistake | there is no `null` for an `int` in WebAssembly (S-13). Fields are not affected: they start at the Java default in both |
| `n == null` where `n` is an `int`, `float`, `boolean` or `char` | allowed | a mistake: `cannot compare int with null` | same reason |
| A function that is not `void` and has a path with no `return` | reported when a call ends without a value | reported once, at the declaration, for every such path | the checker looks at all the paths, not the one that ran |
| What `return` gets wrong (wrong type, value in a `void` function) | at the call that ran | at the `return` statement | the checker sees the statement, not the call |
| `parseInt("Hola")`, `parseFloat("x")` | a mistake when it runs | not a mistake | it depends on a value only a run has |
| Code after a mistake | keeps running; a failed value is `null` | the program does not compile | a compiler needs a type for every expression |
| `string + array` or `string + object` | joins their text | accepted for now | Phase C decides whether compiled code can show an array or an object |

Anything else the interpreter reports while running, the checker reports too, with the same words. `tests/unit/check-agreement.test.ts` runs the two on every program the project owns (the examples, the seven samples, the examples of `LANGUAGE.md`, the catalogue of class mistakes: 110 programs) and checks two rules:

1. if the checker finds nothing, the interpreter reports no type mistake;
2. every type mistake the interpreter reports, the checker reports (the value-dependent ones aside).

## The type of `a ? b : c` (S-14)

A conditional has one type, whichever side is chosen. `int` with `float` gives `float`; `char` with `int` gives `int`; `null` with a reference type gives the reference type; a class with its parent gives the parent; anything else is a mistake. The interpreter follows the same rule, taking the static type from the checker (`run()` passes the types in), so `true ? 1 : 2.5` is the float `1.0` in both. This is listed in `docs/language-changes.md`.
