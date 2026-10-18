# The compiler

OakLand has two ways to run a program. The **interpreter** walks the syntax tree and records a trace, so the page can show every step. The **compiler** turns the same program, checked by the same type checker, into a **WebAssembly module**: a small binary the browser runs at machine speed. This page explains how, from a line of source to the bytes, and ends with one program followed all the way.

You can see it work: in the page, switch to **Compile**. The source stays on the left, and the WebAssembly it became is on the right, one block per function. **Compare** runs both modes on the same program.

- [The pipeline](#the-pipeline)
- [Values and memory](#values-and-memory)
- [How the pieces of the language become instructions](#how-the-pieces-of-the-language-become-instructions)
- [Mistakes and limits](#mistakes-and-limits)
- [A worked example](#a-worked-example)
- [How it is tested](#how-it-is-tested)
- [What it does not do](#what-it-does-not-do)

## The pipeline

```
source text
   │  src/core/lexer, parser     tokens, then a syntax tree with a position on every node
   ▼
   │  src/core/check             the type of every expression; every mistake the interpreter would find, and more,
   ▼                             before anything runs. A program with a mistake is not compiled.
   │  src/core/compile/lower.ts  the checked tree → the IR: a tree of WebAssembly-shaped instructions
   ▼
   ├─ encode.ts                  the IR → bytes (a module, section by section)
   └─ wat.ts                     the IR → text (what the page shows)
   │  WebAssembly.validate       the engine itself checks the module (it is the independent check)
   ▼
   │  new WebAssembly.Instance   with the few imports of host.ts
   ▼  main()                     the program runs; what it prints and how it ends come back as a result
```

`compile(source)` returns `{ ok, diagnostics, wasm, wat, sites }` and **never throws**: a bug of the compiler itself is reported as a diagnostic. `runCompiled(result)` runs the module and never throws either. Both are plain TypeScript with no DOM, so the same code runs in Node (every test) and in the Web Worker (the page).

There is **one IR and two writers** (`encode.ts`, `wat.ts`): the text the page shows is printed from the very tree the bytes are made from, so it cannot drift from what runs. Nothing is assembled by a tool: there is no `wabt`, no `binaryen`, no Rust or C toolchain. The browser's `WebAssembly.validate` is the independent referee.

| File | What it does |
|---|---|
| `check/` | The static type checker. Shared rules with the interpreter (`types.ts`, `classes.ts`). |
| `compile/ir.ts` | The IR: expressions as folded WebAssembly, referring to locals, labels and functions by name. |
| `compile/lower.ts` | The translation. One function per construct of the language. |
| `compile/runtime.ts` | The runtime, **written in the IR** so it shows in the WebAssembly view: the allocator, strings, arrays. |
| `compile/encode.ts`, `bytes.ts`, `opcodes.ts` | The binary encoder: LEB128, the sections, the opcodes. |
| `compile/wat.ts` | The text printer. |
| `compile/host.ts` | The imports a program may call, and the table of places that can fail. |
| `compile/index.ts` | `compile()` and `runCompiled()`. |

## Values and memory

| In OakLand | In WebAssembly |
|---|---|
| `int` (32-bit, wraps), `char`, `boolean` | `i32` |
| `float` | `f64` |
| a string, an array, a struct, an object | `i32`: an **address** in linear memory |
| `null` | the address `0`, which nothing is ever stored at |

**Memory** is one linear memory, 1 page (64 KiB) at the start and at most 4,096 pages (256 MiB). The static data (string literals) comes first; after it, the heap. The allocator is a **bump pointer**: it hands out the next free address, grows the memory when it runs out, and **never frees**. A program that keeps allocating ends with `out of memory`. (A collector was a stretch goal and is not here.)

- A **string** is `[length: i32][UTF-16 code units]`. `==` compares the contents; `<` compares code unit by code unit.
- An **array** is `[length: i32][4 bytes of padding][elements]`: elements are 4 bytes, or 8 for a `float`, and the padding keeps an 8-byte element aligned. A matrix is an array of addresses of arrays.
- A **struct** or an **object** is `[vtable base: i32][mark: i32][fields]`, each field in declaration order (a parent's first, so a variable typed as the parent finds a field in the same place), a `float` on a multiple of 8. Everything starts at zero, which is the default of every type.
- A **vtable** lives in the module's function table: slot 0 is the function that shows the object as text, then one slot per method that a subclass may override. A virtual call loads the object's vtable base, adds the method's slot, and does `call_indirect`. A method that no subclass redefines is called directly.
- The **mark** word is set while an object (or an array that can hold objects) is being printed, so that a cycle is printed as `Node{...}` or `[...]` instead of for ever.

The functions that do the work of memory (`rt:alloc`, `rt:str_concat`, `rt:new_array`, `rt:elem_addr`, …) are small functions written in the IR and added to the module when something needs them. That is why the two-line program of the worked example below is 189 bytes and one that builds a string carries the string functions.

**The host.** A compiled program asks the page for very little, and `host.ts` lists all of it: `write_i32`, `write_f64`, `write_bool`, `write_char`, `write_string` (printing); `format_float` and `take_text` (a `float` as text: formatting a double the way Java does is a project of its own, so the same JavaScript routine as the interpreter is used, which also makes the two modes agree by construction); `fmod` (the remainder of floats: WebAssembly has no instruction for it); `text_lower`, `text_upper`, `text_time`, `parse_int`, `parse_float` (the built-in functions); and `fail` (a mistake). Everything else, including turning an `int` into text, is compiled.

## How the pieces of the language become instructions

- **Arithmetic.** `int` operations are the `i32` instructions, which wrap like Java's. `/` and `%` go through a small function that checks for zero first (and turns the smallest int divided by -1 into a wrap instead of a trap). A float and an int mixed convert the int first.
- **Control flow.** `if` is `if`. A loop is `block { loop { if not condition then br out; body; br loop } }`; `break` and `continue` are `br` to the right label. A `switch` is a chain of tests that jump into a row of bodies written one after the other, so that falling through comes for free.
- **Functions.** A function is a WebAssembly function; its `return` is `return`. A top-level variable that a function mentions is a WebAssembly **global**; the others stay locals of `main`, which is faster.
- **Classes.** A constructor is `Class.newN(this, …)`, one per number of arguments: first the parent's constructor, then the initial values of the fields, then the body. `new` allocates, stores the vtable base, and calls it. `super.m()` is a direct call.
- **Functions inside functions.** A variable that an inner function mentions cannot stay in a local. The outer function makes a **frame** when it starts, a small record in memory that holds those variables and, in its first word, the frame of the function around it. The inner function receives the frame as a hidden parameter (`$up`) and reaches any variable of any function that encloses it by following the links. Frames are only made when some inner function needs one.
- **Strings.** `+` converts each side to a string (a number through a runtime function, a `float` through the host) and joins them; a `null` reads as the text `null`.
- **Printing.** Every argument of `println` is worked out and held in a local first, and only then written: a call that prints, in the second argument, comes before the first argument's text, exactly as in the interpreter.

## Mistakes and limits

A place in a program that can fail (a division, an index, a field of `null`, an allocation, a call) gets a number: its **site**. `compile()` returns the table of sites (`{ position, message }`); the module holds only the number. When the program fails it calls `env.fail(site, a, b)`; the page looks the site up and makes a diagnostic with the **same words and the same position** as the interpreter's, and the run ends with what was printed so far kept. (The interpreter goes on after a mistake, with a "poison" value; the compiled program stops. That difference is listed in `language-changes.md`, and a test checks that both modes report the same first mistake.)

- **Stack depth** is counted like the interpreter does: a global counts the calls that are open, and the 401st one fails with `stack overflow: more than 400 calls nested inside each other`, at the place of the call.
- **Arrays** are limited to a million elements in all, as in the interpreter.
- **Output** is limited to 200,000 characters.
- **A program that never ends** has no step counter to stop it: the Web Worker is ended by **Stop** or, for a compiled program, after five seconds.
- **Memory** is capped at 256 MiB (`out of memory`), which only the compiled mode has.

## A worked example

This is the whole path for a program of two lines.

```oak
int square(int n) {
  return n * n;
}
System.out.println(square(7) + 1);
```

**1. The checker** gives a type to every expression, and the compiler needs them: `n * n` is an `int` (so the instruction will be `i32.mul`, not `f64.mul`), `square(7)` is an `int`, `square(7) + 1` is an `int` (so `println` will call `write_i32`).

**2. The lowering** turns each node into instructions, and each function of the program into a WebAssembly function. This is the module it makes, as the page shows it:

```wat
(module
  (import "env" "fail" (func $env:fail (param i32 i32 i32)))
  (import "env" "write_i32" (func $env:write_i32 (param i32)))
  (import "env" "write_char" (func $env:write_char (param i32)))
  (memory (export "memory") 1 4096)
  (global $depth (mut i32) (i32.const 0))
  (func $main (export "main")
    (local $result.1 i32) (local $tmp.3 i32)
    (local.set $tmp.3
      (i32.add
        (block $nest.2 (result i32)
          (global.set $depth (i32.add (global.get $depth) (i32.const 1)))
          (if
            (i32.gt_s (global.get $depth) (i32.const 400))
            (then
              (call $env:fail (i32.const 0) (i32.const 0) (i32.const 0))
              (unreachable)))
          (local.set $result.1 (call $square (i32.const 7)))
          (global.set $depth (i32.sub (global.get $depth) (i32.const 1)))
          (local.get $result.1))
        (i32.const 1)))
    (call $env:write_i32 (local.get $tmp.3))
    (call $env:write_char (i32.const 10)))
  (func $square (param $n i32) (result i32)
    (return (i32.mul (local.get $n) (local.get $n)))
    (unreachable))
)
```

Reading it from the inside out:

- `$square` is the function as written: `n * n` is `i32.mul` of the parameter with itself. The `(unreachable)` after the `return` tells the engine that the end of a function with a result is never reached.
- In `$main`, the call `square(7)` is wrapped in the block `$nest.2`. It counts the depth (`$depth` goes up, and if it is above 400 the program fails at site 0, the position of this call), calls `$square` with 7, counts back down, and leaves the result.
- `+ 1` is `i32.add`. The sum waits in the local `$tmp.3` because `println` works out all its arguments before it writes anything.
- `write_i32` prints the number and `write_char` 10 prints the newline. Both are imports: the page provides them.
- `$depth`, the memory and the imports are what the module asks for; nothing else.

**3. The encoder** writes the module as bytes. These are all 189 of them:

```hex
00 61 73 6d 01 00 00 00 01 13 04 60 03 7f 7f 7f 00 60 01 7f 00 60 00 00 60 01 7f 01 7f 02 2d 03 03 65 6e 76 04 66 61 69 6c 00 00 03 65 6e 76 09 77 72 69 74 65 5f 69 33 32 00 01 03 65 6e 76 0a 77 72 69 74 65 5f 63 68 61 72 00 01 03 03 02 02 03 05 05 01 01 01 80 20 06 06 01 7f 01 41 00 0b 07 11 02 04 6d 61 69 6e 00 03 06 6d 65 6d 6f 72 79 02 00 0a 48 02 3c 01 02 7f 02 7f 23 00 41 01 6a 24 00 23 00 41 90 03 4a 04 40 41 00 41 00 41 00 10 00 00 0b 41 07 10 04 21 00 23 00 41 01 6b 24 00 20 00 0b 41 01 6a 21 01 20 01 10 01 41 0a 10 02 0b 09 00 20 00 20 00 6c 0f 00 0b
```

A module is a header and then **sections**, each a number (its kind), a size, and its contents. Numbers are written in LEB128, so small ones take a byte. Here they are, in order:

| Bytes | What they are |
|---|---|
| `00 61 73 6d` `01 00 00 00` | The magic number `\0asm` and the version, 1. |
| `01 13` … | **Types** (section 1, 19 bytes): 4 function shapes. `60 03 7f 7f 7f 00` is "takes three `i32`, returns nothing" (`fail`); `60 01 7f 00` one `i32` in, nothing out (the writers); `60 00 00` nothing in or out (`main`); `60 01 7f 01 7f` one `i32` in, one out (`square`). `7f` is `i32`. |
| `02 2d` … | **Imports** (section 2, 45 bytes): 3 functions from the module `env` (`65 6e 76`): `fail`, `write_i32`, `write_char`, each pointing at one of the shapes above. |
| `03 03 02 02 03` | **Functions** (section 3): two functions are defined here; `main` has shape 2, `square` shape 3. |
| `05 05 01 01 01 80 20` | **Memory** (section 5): one memory, with a maximum, from 1 page to `80 20` = 4,096 pages. |
| `06 06 01 7f 01 41 00 0b` | **Globals** (section 6): one `i32`, mutable (`01`), starting at `41 00` = `i32.const 0` (`$depth`). |
| `07 11 02 …` | **Exports** (section 7): `main` (function 3: the three imports come first) and `memory`. |
| `0a 48 02 …` | **Code** (section 10, 72 bytes): the two bodies. |

And the first body, `main` (`3c` = 60 bytes), instruction by instruction: `01 02 7f` two locals of type `i32`; `02 7f` **block** with an `i32` result; `23 00` `global.get 0`; `41 01` `i32.const 1`; `6a` `i32.add`; `24 00` `global.set 0`; `23 00 41 90 03 4a` `global.get 0`, `i32.const 400`, `i32.gt_s`; `04 40 … 0b` the **if** with its `fail` call (`10 00` is `call` function 0) and `00` (`unreachable`); `41 07 10 04` `i32.const 7`, `call 4` (`square`: three imports, `main`, then `square`); `21 00` `local.set 0`; the count back down `23 00 41 01 6b 24 00`; `20 00` `local.get 0`; `0b` the end of the block; `41 01 6a` `+ 1`; `21 01 20 01 10 01` keep it, `call write_i32`; `41 0a 10 02` `write_char(10)`; `0b` the end. The second body, `square` (`09`): no locals (`00`), `20 00 20 00 6c` `n * n`, `0f` `return`, `00` `unreachable`, `0b` end.

**4. The engine** checks the module (`WebAssembly.validate`), instantiates it with the three imports, and calls `main`. It prints `50` and a newline. In the page, Compile does exactly this inside the Web Worker, times each step, and Compare runs the interpreter on the same text.

## How it is tested

1. **Unit tests of each piece**: the encoder against known byte vectors and a hand-built module that runs in Node; each construct of the language, compiled and interpreted, with the same output required (`tests/unit/compile-*.test.ts`).
2. **The differential harness** (`tests/helpers/differential.ts`): a program is run in both modes and the outputs, and the first mistake with its place and wording, must be the same. It runs over the whole **corpus**: the examples, the seven original course programs, every example of `LANGUAGE.md`, and the catalogue of class mistakes.
3. **A generator of programs** (`tests/helpers/generate.ts`): seeded, well-typed programs that always end, with int overflow, mixed numbers, strings, loops, arrays, classes with overrides, recursion and functions inside functions. The same 200 seeds must agree, and **eight deliberately broken compilers** (one instruction swapped for another) must each be caught by them. A failing program is shrunk by a line-based minimiser.
4. **Fuzz** (`tests/fuzz/compile-fuzz.test.ts`): mutated and random programs must never make `compile()` throw, and every module it returns must validate.
5. **Golden WebAssembly** (`tests/golden/wat/`): six small programs have their text committed, so a change to the compiler is a diff a person can read.
6. **End to end** (`e2e/compile.spec.ts`): the flow in a real browser at 1280 and 375 px with axe: pick Sieve, Compile, read the WebAssembly, Compare; a compiled infinite loop ended by Stop and by the five-second limit.
7. **This page**: the example above is compiled by a test and must match the text and the bytes shown.

## What it does not do

- **No optimisation.** The output is what the translation makes: a local is read where a smarter compiler would keep it on the stack, and a call counts its depth. It is fast because WebAssembly is, not because the code is clever.
- **No garbage collection.** Memory is never given back (see above).
- **No `i64`, no SIMD, no threads.** `int` is 32-bit, as in the language.
- **Strings are not interned** and are not indexed (the language has no `charAt`).
- **Numbers are measured on one machine.** The README says which, and what they do not show.
