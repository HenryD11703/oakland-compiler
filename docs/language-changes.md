# Language changes from the original interpreter

Everything here is a difference between OakLand as the original interpreter (commit `11b0e46`) accepted it and the rebuilt one. Each entry says what changed and why. The seven programs in `tests/fixtures/prueba/` are the regression suite; the original output of each is in `tests/golden/legacy/`.

> Status: **parser (T03–T06) and interpreter (T07–T11) written.** All seven programs parse and run. The four that end with a hand-written "SALIDA ESPERADA" block now print what that block says (`tests/unit/samples-run.test.ts`), ignoring only blank lines, repeated spaces, the quotes the author wrote around some text results, and one line where the author pasted source code instead of output. The table at the end lists, program by program, exactly what changed in the output; it comes from the files in `tests/golden/legacy-diff/`, which a test keeps up to date.

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

## What programs print (runtime)

| Change | Why |
|---|---|
| **Floats print like Java:** `10.5 + 5.5` prints `16.0`, `5.0` stays `5.0`, `1.0E7` for large ones. The original printed `16`. | The course sample's own expected output says `16.0` (AC-02). |
| **Integer division and 32-bit ints:** `7 / 2` is `3`, `-7 / 2` is `-3`, `2147483647 + 1` is `-2147483648`, `100000 * 100000` is `1410065408`. The original gave `3.5`, `-3.5` and numbers beyond 32 bits. A literal above 2147483647 is an error. | Java-like semantics, approved by Henry (AC-01). |
| **`int x;` holds `null` with no error.** The original reported "variable not declared" and then printed `null`. | The sample's expected output says `null`; it is not a mistake (AC-08). |
| **One mistake, one diagnostic.** A failed declaration (`int a = "Hola";`) or assignment leaves the variable null, as the course sample expects, but reports once. The original reported two or three (the real error, then "variable not declared", per later use). | AC-09. |
| **Errors are not mixed into the output.** The original appended "Error: ..." lines to what the program printed. Now the output is only the program's, and problems are diagnostics with a position. | Principle 3. |
| **Widening works on assignment:** `float f = 1.5; f = 2;` is fine (the original rejected it). Narrowing (`int i = 3.5`, `i += 1.5`) is still an error. `char` converts to `int` and `float`. | Java-like. |
| **Strings:** `"n=" + 1`, `"b=" + true`, `"c=" + 'x'` concatenate (the original rejected them); `"a" < "b"` compares (it used to say it cannot compare a string with a string). | Java-like (AC-04). |
| **`char` is a number in arithmetic:** `'a' + 1` is `98`. | Java-like. |
| **`5.5 % 2` works** (`1.5`); the original rejected it. | Java-like. |
| **`&&` and `||` short-circuit.** | AC-05. |
| **Functions can be called before their declaration;** arguments are counted and type-checked (`f(1)` for two parameters, `f("a")` for an int); a wrong return type, a missing return, a value returned from a void function, and using a void call as a value are diagnostics. The original crashed or silently accepted most of these. | AC-13 to AC-15. |
| **`switch` runs `default` when no case matches.** The original ran it only after falling through from a matching case. | Java-like; the original was a bug. |
| **Nested arrays print as `[[1, 2], [3, 4]]`** (the original printed `[, ]`). `for (var row : matrix)` works. An out-of-range index says which index and the length. | Fixes. |
| **Both `parsefloat` (the course's spelling) and `parseFloat` (the README's) work.** | The original only registered the first; the README documented the second. |
| **`typeof x` for `int x;` is `int`** (the original failed). **`x == null`** works. | Fixes. |
| **Limits:** at most 20,000,000 steps, 5 s, 400 nested calls (Java allows far more: the interpreter uses the JavaScript stack, which gives out first, so a recursive sum up to 1000 does not fit), 200,000 characters of output and 1,000,000 array elements per array. A runaway program ends with a diagnostic and keeps its output; the original froze the page. Very deep recursion that exhausts the JavaScript stack first is reported as a stack overflow too. | AC-24. |

### Unchanged on purpose
- `System.out.println(a, b)` separates arguments with one space.
- `int[] b = a;` **copies** the array (the sample says "por copia"); `b = a;` and passing an array to a function **share** it.
- `ternary` takes the type of the branch it chooses (`true ? 1 : 2.5` is the int `1`).
- `time()` returns an ISO date-time string.
- Variables, functions and structs share one namespace per scope; a redeclared name keeps the first.

## The seven programs, one by one (AC-19)

Each row is checked by `tests/unit/golden.test.ts`. "Diagnostics" are the mistakes the program contains on purpose, reported now as diagnostics with a position instead of lines mixed into the output.

| Program | Printed text | Diagnostics (original → now) |
|---|---|---|
| `1- Ciclos.txt` | identical | 0 → 0 |
| `2 - Bloques.txt` | identical | 0 → 0 |
| `4 - Funciones.txt` | identical (with `time()` frozen) | 0 → 0 |
| `arrays.oak` | identical | 0 → 0 |
| `intermedias.oak` | the line `Error: variable a ya declarada` is gone from the output; the mistake (`int a = 20;` repeated) is the diagnostic at 12:5 | 1 → 1 |
| `basicas.oak` | `16`, `5`, `55`, `205` print as `16.0`, `5.0`, `55.0`, `205.0`; the two `variable ... no declarada` lines for `int numero3;` / `float numero4;` are gone (they are `null`, not mistakes); the error lines for the two deliberate type mistakes are gone from the output | 6 → 2 (206:23 and 212:19) |
| `funciones.oak` | `parsefloat("10")` prints `10.0` instead of `10`; the ten error lines for the five deliberate mistakes are gone from the output | 5 → 5 (116, 117, 129, 143 and 151) |

So on these programs the only changes in what is printed are **float text** and **error lines moving out of the output**. Everything else, including the hand-written expected outputs of the course, matches.
