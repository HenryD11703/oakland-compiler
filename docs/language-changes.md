# Language changes from the original interpreter

Everything here is a difference between OakLand as the original interpreter (commit `11b0e46`) accepted it and the rebuilt one. Each entry says what changed and why. The seven programs in `tests/fixtures/prueba/` are the regression suite; the original output of each is in `tests/golden/legacy/`.

> Status: **parser part only (T03–T06).** The runtime part (what the programs print) is added when the interpreter is rebuilt (T14). All seven programs already parse with no diagnostics.

## Syntax

| Change | Why |
|---|---|
| **New:** `i++;` and `i--;` as statements and in the update part of `for`, on variables, array elements and struct fields. Not allowed inside other expressions (`a[i++]` is an error with a clear message). | Approved by Henry (spec AC-06). |
| **New:** `p.name` reads a field, `p.name = x` and `p.name++` change it, `Person{name: "Ana", age: 20}` creates a value. | The original grammar had no way to read a field (spec AC-18). |
| **Fixed:** a name may start with a keyword (`trueValue`, `nullable`). A reserved word alone is rejected with a clear message. | The original read `true` / `null` as the start of the name and failed (spec AC-07). |
| **Relaxed:** `System.out.println()` with no arguments is allowed (prints an empty line). | It was a syntax error for no good reason. |
| **Relaxed:** `int[] a = {};` (empty list) is allowed. | Same. |
| **Relaxed:** `;` after the closing `}` of a `struct` is optional. | The original required it. |
| **Relaxed:** struct names, parameters, return types and arrays can use a struct type (`Person[] ps`, `Person make()`). | Needed for structs to be usable. |
| **Stricter:** a string literal must end on the same line it starts. | In the original an unterminated `"` swallowed the rest of the file and hid the real error. |
| **Stricter:** a struct body holds only fields (`int age;`). | The original accepted any statement inside it. |
| **Removed:** `[expr]` as a grouping alternative to `(expr)`, and `name : value` as a free-standing expression. | Accidents of the original grammar (the second only exists now inside `Person{name: value}`). No sample uses them. |
| **Changed:** a declaration is not allowed as the single body of `if`/`while`/`for` (`if (x) int y = 1;`). The error says to use `{ }`. | The original failed with a generic message. |

## Diagnostics
- Syntax and lexical problems now carry a position, a plain-English message and a phase, and up to 10 are reported per run (the original stopped at the first one and showed a list of every token it might have accepted).
- If there is any lexical or syntax error the program does not run (the original also refused, with an exception shown as "Error fatal").
