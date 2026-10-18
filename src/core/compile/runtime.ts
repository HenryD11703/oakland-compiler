import type { HostName } from "./host";
import { ir, type Expr, type Func, type Local } from "./ir";

/**
 * The part of the runtime that deals with memory and strings (plan D16), written in the IR so that it shows up in the
 * WAT view like any other function. A string is `[length: i32][UTF-16 code units]`; `0` is `null`.
 */
export const MEMORY_RUNTIME_NAMES = [
  "alloc",
  "int_to_str",
  "char_to_str",
  "float_to_str",
  "lower_str",
  "upper_str",
  "time_str",
  "str_concat",
  "str_eq",
  "str_cmp",
  "new_array",
  "check_size",
  "non_null",
  "elem_addr",
  "array_length",
  "index_of_i32",
  "index_of_f64",
  "index_of_str",
  "join_strings",
] as const;
export type MemoryRuntimeName = (typeof MEMORY_RUNTIME_NAMES)[number];

/** An array is `[length: i32][4 bytes of padding][elements]`, so that an 8-byte float element is always aligned. */
export const ARRAY_HEADER = 8;

/** What a runtime function asks of the lowerer that holds it. */
export interface RuntimeNeeds {
  /** The name a host import is called by (and makes sure the module imports it). */
  host(name: HostName): string;
  /** The name of another runtime function (and makes sure the module carries it). */
  call(name: MemoryRuntimeName): string;
  /** The address of a string literal in the data segment. */
  literal(text: string): number;
}

/** The name of the global that holds the first free address. */
export const HEAP = "heap";

/** The memory is capped at 256 MiB (spec S-20), which is 4096 pages of 64 KiB. */
export const MAX_PAGES = 4096;
const MAX_ALLOCATION = MAX_PAGES * 65536;

const local = (name: string): Local => ({ name, type: "i32" });
const get = ir.get;
const i32 = ir.i32;
const op = ir.op;

/** `size` bytes into `len` code units: a string of `len` units takes `4 + 2 * len` bytes. */
const stringBytes = (len: Expr): Expr => op("i32.add", i32(4), op("i32.shl", len, i32(1)));

/** The code unit at index `i` of the string at `s`. */
const unitAt = (s: string, i: string): Expr => ir.load("i32.load16_u", op("i32.add", get(s), op("i32.shl", get(i), i32(1))), 4);

const length = (s: string): Expr => ir.load("i32.load", get(s));

export function memoryRuntime(name: MemoryRuntimeName, needs: RuntimeNeeds): Func {
  const full = `rt:${name}`;
  const fail = (): Expr[] => [ir.call(needs.host("fail"), get("site"), i32(0), i32(0)), ir.unreachable()];
  /** Fails at the place `site` names, filling `{0}` and `{1}` of its message with two numbers. */
  const failWith = (site: Expr, a: Expr, b: Expr): Expr[] => [ir.call(needs.host("fail"), site, a, b), ir.unreachable()];
  /** The address of element `index` of the array named `arrayName`, for 4-byte elements when `shift` is 2 and 8-byte when it is 3. */
  const slot = (arrayName: string, index: Expr, shift: Expr): Expr => op("i32.add", get(arrayName), op("i32.shl", index, shift));
  const alloc = (): string => needs.call("alloc");

  switch (name) {
    // A bump allocator: nothing is ever freed. It grows the memory when it runs out, up to the cap, and then fails.
    case "alloc":
      return {
        name: full,
        params: [local("size"), local("site")],
        results: ["i32"],
        locals: [local("p"), local("end"), local("have")],
        body: [
          ir.if(op("i32.gt_u", get("size"), i32(MAX_ALLOCATION)), fail()),
          ir.set("p", ir.getGlobal(HEAP)),
          // Round up to a multiple of 8, so every object starts on an address a load can use as is.
          ir.set("end", op("i32.and", op("i32.add", op("i32.add", get("p"), get("size")), i32(7)), i32(-8))),
          ir.set("have", op("i32.shl", ir.memorySize(), i32(16))),
          ir.if(op("i32.gt_u", get("end"), get("have")), [
            ir.if(
              op("i32.eq", ir.memoryGrow(op("i32.shr_u", op("i32.add", op("i32.sub", get("end"), get("have")), i32(65535)), i32(16))), i32(-1)),
              fail(),
            ),
          ]),
          ir.setGlobal(HEAP, get("end")),
          get("p"),
        ],
      };

    // An int as text, in decimal: count the digits, make the string, then fill it from the right.
    case "int_to_str":
      return {
        name: full,
        params: [local("n"), local("site")],
        results: ["i32"],
        locals: [local("neg"), local("m"), local("t"), local("count"), local("p"), local("i")],
        body: [
          ir.set("neg", op("i32.lt_s", get("n"), i32(0))),
          // The magnitude is read as unsigned, so that the smallest int (whose negation is itself) comes out right.
          ir.set("m", ir.select(op("i32.sub", i32(0), get("n")), get("n"), get("neg"))),
          ir.set("t", get("m")),
          ir.set("count", i32(1)),
          ir.block("counted", [
            ir.loop("more", [
              ir.brIf("counted", op("i32.lt_u", get("t"), i32(10))),
              ir.set("t", op("i32.div_u", get("t"), i32(10))),
              ir.set("count", op("i32.add", get("count"), i32(1))),
              ir.br("more"),
            ]),
          ]),
          ir.set("count", op("i32.add", get("count"), get("neg"))),
          ir.set("p", ir.call(alloc(), stringBytes(get("count")), get("site"))),
          ir.store("i32.store", get("p"), get("count")),
          ir.set("i", get("count")),
          ir.loop("digit", [
            ir.set("i", op("i32.sub", get("i"), i32(1))),
            ir.store("i32.store16", op("i32.add", get("p"), op("i32.shl", get("i"), i32(1))), op("i32.add", i32(48), op("i32.rem_u", get("m"), i32(10))), 4),
            ir.set("m", op("i32.div_u", get("m"), i32(10))),
            ir.brIf("digit", op("i32.gt_s", op("i32.sub", get("i"), get("neg")), i32(0))),
          ]),
          ir.if(get("neg"), [ir.store("i32.store16", get("p"), i32(45), 4)]),
          get("p"),
        ],
      };

    case "char_to_str":
      return {
        name: full,
        params: [local("c"), local("site")],
        results: ["i32"],
        locals: [local("p")],
        body: [
          ir.set("p", ir.call(alloc(), stringBytes(i32(1)), get("site"))),
          ir.store("i32.store", get("p"), i32(1)),
          ir.store("i32.store16", get("p"), get("c"), 4),
          get("p"),
        ],
      };

    // A float as text is the one place the host helps (plan D17): it formats, the program makes the string and the host fills it.
    case "float_to_str":
      return {
        name: full,
        params: [{ name: "x", type: "f64" }, local("site")],
        results: ["i32"],
        locals: [local("n"), local("p")],
        body: [
          ir.set("n", ir.call(needs.host("format_float"), get("x"))),
          ir.set("p", ir.call(alloc(), stringBytes(get("n")), get("site"))),
          ir.store("i32.store", get("p"), get("n")),
          ir.call(needs.host("take_text"), op("i32.add", get("p"), i32(4))),
          get("p"),
        ],
      };

    // The text built-ins: the host works the text out, the program makes the string and the host fills it.
    case "lower_str":
    case "upper_str":
    case "time_str": {
      const hostName = name === "lower_str" ? "text_lower" : name === "upper_str" ? "text_upper" : "text_time";
      const given = name === "time_str" ? [] : [get("s")];
      return {
        name: full,
        params: [...(name === "time_str" ? [] : [local("s")]), local("site")],
        results: ["i32"],
        locals: [local("n"), local("p")],
        body: [
          ir.set("n", ir.call(needs.host(hostName), ...given)),
          ir.set("p", ir.call(alloc(), stringBytes(get("n")), get("site"))),
          ir.store("i32.store", get("p"), get("n")),
          ir.call(needs.host("take_text"), op("i32.add", get("p"), i32(4))),
          get("p"),
        ],
      };
    }

    // Joining two strings; a null on either side reads as the text "null", like in Java.
    case "str_concat": {
      const nothing = i32(needs.literal("null"));
      return {
        name: full,
        params: [local("a"), local("b"), local("site")],
        results: ["i32"],
        locals: [local("la"), local("lb"), local("p")],
        body: [
          ir.if(op("i32.eqz", get("a")), [ir.set("a", nothing)]),
          ir.if(op("i32.eqz", get("b")), [ir.set("b", nothing)]),
          ir.set("la", length("a")),
          ir.set("lb", length("b")),
          ir.set("p", ir.call(alloc(), stringBytes(op("i32.add", get("la"), get("lb"))), get("site"))),
          ir.store("i32.store", get("p"), op("i32.add", get("la"), get("lb"))),
          op("memory.copy", op("i32.add", get("p"), i32(4)), op("i32.add", get("a"), i32(4)), op("i32.shl", get("la"), i32(1))),
          op("memory.copy", op("i32.add", op("i32.add", get("p"), i32(4)), op("i32.shl", get("la"), i32(1))), op("i32.add", get("b"), i32(4)), op("i32.shl", get("lb"), i32(1))),
          get("p"),
        ],
      };
    }

    // Equal by value; two nulls are equal and a null is not equal to a string.
    case "str_eq":
      return {
        name: full,
        params: [local("a"), local("b")],
        results: ["i32"],
        locals: [local("n"), local("i")],
        body: [
          ir.if(op("i32.eq", get("a"), get("b")), [ir.return(i32(1))]),
          ir.if(op("i32.or", op("i32.eqz", get("a")), op("i32.eqz", get("b"))), [ir.return(i32(0))]),
          ir.set("n", length("a")),
          ir.if(op("i32.ne", get("n"), length("b")), [ir.return(i32(0))]),
          ir.set("i", i32(0)),
          ir.block("same", [
            ir.loop("next", [
              ir.brIf("same", op("i32.ge_u", get("i"), get("n"))),
              ir.if(op("i32.ne", unitAt("a", "i"), unitAt("b", "i")), [ir.return(i32(0))]),
              ir.set("i", op("i32.add", get("i"), i32(1))),
              ir.br("next"),
            ]),
          ]),
          i32(1),
        ],
      };

    // -1, 0 or 1: by the first code unit that differs, else by length (what `<` does in JavaScript and in the interpreter).
    case "str_cmp":
      return {
        name: full,
        params: [local("a"), local("b"), local("site")],
        results: ["i32"],
        locals: [local("na"), local("nb"), local("m"), local("i"), local("ca"), local("cb")],
        body: [
          ir.if(op("i32.or", op("i32.eqz", get("a")), op("i32.eqz", get("b"))), fail()),
          ir.set("na", length("a")),
          ir.set("nb", length("b")),
          ir.set("m", ir.select(get("na"), get("nb"), op("i32.lt_u", get("na"), get("nb")))),
          ir.set("i", i32(0)),
          ir.block("tied", [
            ir.loop("next", [
              ir.brIf("tied", op("i32.ge_u", get("i"), get("m"))),
              ir.set("ca", unitAt("a", "i")),
              ir.set("cb", unitAt("b", "i")),
              ir.if(op("i32.ne", get("ca"), get("cb")), [ir.return(ir.select(i32(-1), i32(1), op("i32.lt_u", get("ca"), get("cb"))))]),
              ir.set("i", op("i32.add", get("i"), i32(1))),
              ir.br("next"),
            ]),
          ]),
          ir.select(i32(-1), ir.select(i32(1), i32(0), op("i32.gt_u", get("na"), get("nb"))), op("i32.lt_u", get("na"), get("nb"))),
        ],
      };

    // An array of `len` elements, all zero (which is 0, 0.0, false, the character 0 and null) unless `fill` says otherwise.
    case "new_array":
      return {
        name: full,
        params: [local("len"), local("shift"), local("fill"), local("site")],
        results: ["i32"],
        locals: [local("p"), local("i")],
        body: [
          ir.if(op("i32.gt_u", get("len"), op("i32.shr_u", i32(MAX_ALLOCATION), get("shift"))), fail()),
          ir.set("p", ir.call(alloc(), op("i32.add", i32(ARRAY_HEADER), op("i32.shl", get("len"), get("shift"))), get("site"))),
          ir.store("i32.store", get("p"), get("len")),
          // The memory is fresh and never reused, so it is already zero; only a non-zero default needs writing (an empty string).
          ir.if(get("fill"), [
            ir.set("i", i32(0)),
            ir.block("filled", [
              ir.loop("next", [
                ir.brIf("filled", op("i32.ge_u", get("i"), get("len"))),
                ir.store("i32.store", op("i32.add", get("p"), op("i32.shl", get("i"), i32(2))), get("fill"), ARRAY_HEADER),
                ir.set("i", op("i32.add", get("i"), i32(1))),
                ir.br("next"),
              ]),
            ]),
          ]),
          get("p"),
        ],
      };

    // The size of an array, checked before anything is made: it may not be negative.
    case "check_size":
      return {
        name: full,
        params: [local("n"), local("site")],
        results: ["i32"],
        locals: [],
        body: [ir.if(op("i32.lt_s", get("n"), i32(0)), failWith(get("site"), get("n"), i32(0))), get("n")],
      };

    case "non_null":
      return { name: full, params: [local("p"), local("site")], results: ["i32"], locals: [], body: [ir.if(op("i32.eqz", get("p")), fail()), get("p")] };

    // Where element `index` of `arr` is, checked: `site` says "cannot index null" and `site + 1` says the index is out of range.
    case "elem_addr":
      return {
        name: full,
        params: [local("arr"), local("index"), local("shift"), local("site")],
        results: ["i32"],
        locals: [local("len")],
        body: [
          ir.if(op("i32.eqz", get("arr")), fail()),
          ir.set("len", length("arr")),
          ir.if(op("i32.ge_u", get("index"), get("len")), failWith(op("i32.add", get("site"), i32(1)), get("index"), get("len"))),
          slot("arr", get("index"), get("shift")),
        ],
      };

    case "array_length":
      return { name: full, params: [local("arr"), local("site")], results: ["i32"], locals: [], body: [ir.if(op("i32.eqz", get("arr")), fail()), length("arr")] };

    // `indexOf`: the first position that holds the value, or -1. The three versions differ only in how two elements are compared.
    case "index_of_i32":
    case "index_of_f64":
    case "index_of_str": {
      const kind = name === "index_of_f64" ? "f64" : "i32";
      const element = ir.load(kind === "f64" ? "f64.load" : "i32.load", slot("arr", get("i"), i32(kind === "f64" ? 3 : 2)), ARRAY_HEADER);
      const same = name === "index_of_str" ? ir.call(needs.call("str_eq"), element, get("x")) : kind === "f64" ? op("f64.eq", element, get("x")) : op("i32.eq", element, get("x"));
      return {
        name: full,
        params: [local("arr"), { name: "x", type: kind }, local("site")],
        results: ["i32"],
        locals: [local("len"), local("i")],
        body: [
          ir.if(op("i32.eqz", get("arr")), fail()),
          ir.set("len", length("arr")),
          ir.set("i", i32(0)),
          ir.block("missing", [
            ir.loop("next", [
              ir.brIf("missing", op("i32.ge_u", get("i"), get("len"))),
              ir.if(same, [ir.return(get("i"))]),
              ir.set("i", op("i32.add", get("i"), i32(1))),
              ir.br("next"),
            ]),
          ]),
          i32(-1),
        ],
      };
    }

    // The elements, already turned into strings (an array of strings), joined with ", " and optionally wrapped in [ ].
    case "join_strings": {
      const nothing = i32(needs.literal("null"));
      const piece = (): Expr => ir.load("i32.load", slot("strs", get("i"), i32(2)), ARRAY_HEADER);
      return {
        name: full,
        params: [local("strs"), local("bracketed"), local("site")],
        results: ["i32"],
        locals: [local("n"), local("i"), local("s"), local("total"), local("p"), local("q"), local("len")],
        body: [
          ir.set("n", length("strs")),
          ir.set("total", op("i32.shl", get("bracketed"), i32(1))),
          ir.if(op("i32.gt_s", get("n"), i32(0)), [ir.set("total", op("i32.add", get("total"), op("i32.shl", op("i32.sub", get("n"), i32(1)), i32(1))))]),
          ir.set("i", i32(0)),
          ir.block("measured", [
            ir.loop("measure", [
              ir.brIf("measured", op("i32.ge_u", get("i"), get("n"))),
              ir.set("s", piece()),
              ir.if(op("i32.eqz", get("s")), [ir.set("s", nothing)]),
              ir.set("total", op("i32.add", get("total"), length("s"))),
              ir.set("i", op("i32.add", get("i"), i32(1))),
              ir.br("measure"),
            ]),
          ]),
          ir.set("p", ir.call(alloc(), stringBytes(get("total")), get("site"))),
          ir.store("i32.store", get("p"), get("total")),
          ir.set("q", op("i32.add", get("p"), i32(4))),
          ir.if(get("bracketed"), [ir.store("i32.store16", get("q"), i32(91)), ir.set("q", op("i32.add", get("q"), i32(2)))]),
          ir.set("i", i32(0)),
          ir.block("written", [
            ir.loop("write", [
              ir.brIf("written", op("i32.ge_u", get("i"), get("n"))),
              ir.if(get("i"), [
                ir.store("i32.store16", get("q"), i32(44)),
                ir.store("i32.store16", get("q"), i32(32), 2),
                ir.set("q", op("i32.add", get("q"), i32(4))),
              ]),
              ir.set("s", piece()),
              ir.if(op("i32.eqz", get("s")), [ir.set("s", nothing)]),
              ir.set("len", length("s")),
              op("memory.copy", get("q"), op("i32.add", get("s"), i32(4)), op("i32.shl", get("len"), i32(1))),
              ir.set("q", op("i32.add", get("q"), op("i32.shl", get("len"), i32(1)))),
              ir.set("i", op("i32.add", get("i"), i32(1))),
              ir.br("write"),
            ]),
          ]),
          ir.if(get("bracketed"), [ir.store("i32.store16", get("q"), i32(93))]),
          get("p"),
        ],
      };
    }
  }
}
