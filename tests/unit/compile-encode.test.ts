import { describe, expect, it } from "vitest";
import { ByteWriter } from "../../src/core/compile/bytes";
import { encode, EncodeError } from "../../src/core/compile/encode";
import { emptyModule, ir, type Func, type Module, type Signature } from "../../src/core/compile/ir";

const bytesOf = (write: (w: ByteWriter) => void): number[] => {
  const w = new ByteWriter();
  write(w);
  return w.bytes;
};

/** Encodes, asks the engine whether the module is valid, and returns an instance of it. */
function build(module: Module, imports: WebAssembly.Imports = {}): WebAssembly.Exports {
  const bytes = encode(module);
  expect(WebAssembly.validate(bytes), "the engine rejected the module").toBe(true);
  return new WebAssembly.Instance(new WebAssembly.Module(bytes), imports).exports;
}

/** A function that is exported under its own name; `export: null` keeps it private. */
const fn = (name: string, params: [string, "i32" | "f64"][], results: ("i32" | "f64")[], body: Func["body"], extra: Partial<Omit<Func, "export">> & { export?: string | null } = {}): Func => {
  const { export: exported = name, ...rest } = extra;
  return { name, params: params.map(([n, type]) => ({ name: n, type })), results, locals: [], body, ...rest, ...(exported === null ? {} : { export: exported }) };
};

const withFunctions = (...functions: Func[]): Module => ({ ...emptyModule, functions });

describe("the binary encodings", () => {
  it("writes unsigned LEB128: seven bits at a time, low first", () => {
    expect(bytesOf((w) => w.u32(0))).toEqual([0x00]);
    expect(bytesOf((w) => w.u32(127))).toEqual([0x7f]);
    expect(bytesOf((w) => w.u32(128))).toEqual([0x80, 0x01]);
    expect(bytesOf((w) => w.u32(624485))).toEqual([0xe5, 0x8e, 0x26]); // the example of the DWARF and wasm specs
    expect(bytesOf((w) => w.u32(0xffffffff))).toEqual([0xff, 0xff, 0xff, 0xff, 0x0f]);
  });

  it("writes signed LEB128, so that small negative numbers are short", () => {
    expect(bytesOf((w) => w.i32(0))).toEqual([0x00]);
    expect(bytesOf((w) => w.i32(2))).toEqual([0x02]);
    expect(bytesOf((w) => w.i32(-2))).toEqual([0x7e]);
    expect(bytesOf((w) => w.i32(63))).toEqual([0x3f]);
    expect(bytesOf((w) => w.i32(64))).toEqual([0xc0, 0x00]);
    expect(bytesOf((w) => w.i32(-64))).toEqual([0x40]);
    expect(bytesOf((w) => w.i32(-65))).toEqual([0xbf, 0x7f]);
    expect(bytesOf((w) => w.i32(127))).toEqual([0xff, 0x00]);
    expect(bytesOf((w) => w.i32(-127))).toEqual([0x81, 0x7f]);
    expect(bytesOf((w) => w.i32(128))).toEqual([0x80, 0x01]);
    expect(bytesOf((w) => w.i32(-128))).toEqual([0x80, 0x7f]);
    expect(bytesOf((w) => w.i32(2147483647))).toEqual([0xff, 0xff, 0xff, 0xff, 0x07]);
    expect(bytesOf((w) => w.i32(-2147483648))).toEqual([0x80, 0x80, 0x80, 0x80, 0x78]);
  });

  it("writes a float as eight little-endian bytes, and a name as its length and its UTF-8", () => {
    expect(bytesOf((w) => w.f64(1))).toEqual([0, 0, 0, 0, 0, 0, 0xf0, 0x3f]);
    expect(bytesOf((w) => w.f64(-2))).toEqual([0, 0, 0, 0, 0, 0, 0, 0xc0]);
    expect(bytesOf((w) => w.name("abc"))).toEqual([3, 97, 98, 99]);
    expect(bytesOf((w) => w.name("é"))).toEqual([2, 0xc3, 0xa9]);
  });

  it("wraps a section with its id and the size of its contents", () => {
    expect(bytesOf((w) => w.section(5, new ByteWriter().u8(1).u8(0).u8(1)))).toEqual([5, 3, 1, 0, 1]);
  });

  it("every integer survives the round trip through the engine", () => {
    const numbers = [0, 1, -1, 63, 64, -64, -65, 127, 128, -128, 255, 65535, 65536, 1 << 30, 2147483647, -2147483648];
    for (const n of numbers) {
      const exports = build(withFunctions(fn("n", [], ["i32"], [ir.i32(n)])));
      expect((exports.n as () => number)(), `i32.const ${n}`).toBe(n);
    }
  });
});

describe("a module built by hand runs in the engine (T43)", () => {
  it("adds two numbers", () => {
    const exports = build(withFunctions(fn("add", [["a", "i32"], ["b", "i32"]], ["i32"], [ir.op("i32.add", ir.get("a"), ir.get("b"))])));
    expect((exports.add as (a: number, b: number) => number)(2, 3)).toBe(5);
    expect((exports.add as (a: number, b: number) => number)(2147483647, 1)).toBe(-2147483648); // 32-bit wrap
  });

  it("has an empty module that is valid", () => {
    expect(WebAssembly.validate(encode(emptyModule))).toBe(true);
  });

  it("does the arithmetic of int: truncating division, the sign of the remainder, wrap-around multiplication", () => {
    const exports = build(
      withFunctions(
        fn("div", [["a", "i32"], ["b", "i32"]], ["i32"], [ir.op("i32.div_s", ir.get("a"), ir.get("b"))]),
        fn("rem", [["a", "i32"], ["b", "i32"]], ["i32"], [ir.op("i32.rem_s", ir.get("a"), ir.get("b"))]),
        fn("mul", [["a", "i32"], ["b", "i32"]], ["i32"], [ir.op("i32.mul", ir.get("a"), ir.get("b"))]),
      ),
    ) as Record<string, (a: number, b: number) => number>;
    expect(exports.div?.(7, 2)).toBe(3);
    expect(exports.div?.(-7, 2)).toBe(-3);
    expect(exports.rem?.(7, 3)).toBe(1);
    expect(exports.rem?.(-7, 3)).toBe(-1);
    expect(exports.rem?.(7, -3)).toBe(1);
    expect(exports.mul?.(100000, 100000)).toBe(1410065408);
  });

  it("traps on division by zero and on the one overflowing division, as the engine always does", () => {
    const exports = build(withFunctions(fn("div", [["a", "i32"], ["b", "i32"]], ["i32"], [ir.op("i32.div_s", ir.get("a"), ir.get("b"))]))) as Record<string, (a: number, b: number) => number>;
    expect(() => exports.div?.(1, 0)).toThrow(WebAssembly.RuntimeError);
    expect(() => exports.div?.(-2147483648, -1)).toThrow(WebAssembly.RuntimeError);
  });

  it("does float arithmetic and converts between int and float", () => {
    const exports = build(
      withFunctions(
        fn("hyp", [["x", "f64"], ["y", "f64"]], ["f64"], [ir.op("f64.sqrt", ir.op("f64.add", ir.op("f64.mul", ir.get("x"), ir.get("x")), ir.op("f64.mul", ir.get("y"), ir.get("y"))))]),
        fn("widen", [["n", "i32"]], ["f64"], [ir.op("f64.convert_i32_s", ir.get("n"))]),
        fn("cut", [["x", "f64"]], ["i32"], [ir.op("i32.trunc_sat_f64_s", ir.get("x"))]),
        fn("less", [["x", "f64"], ["y", "f64"]], ["i32"], [ir.op("f64.lt", ir.get("x"), ir.get("y"))]),
      ),
    ) as Record<string, (...args: number[]) => number>;
    expect(exports.hyp?.(3, 4)).toBe(5);
    expect(exports.widen?.(-7)).toBe(-7);
    expect(exports.cut?.(3.9)).toBe(3);
    expect(exports.cut?.(-3.9)).toBe(-3);
    expect(exports.cut?.(1e20)).toBe(2147483647);
    expect(exports.less?.(1, 2)).toBe(1);
    expect(exports.less?.(2, 1)).toBe(0);
    expect(exports.less?.(Number.NaN, 1)).toBe(0);
  });

  it("loops: the sum of 1 to n, with locals and a labelled loop", () => {
    const sum = fn(
      "sum",
      [["n", "i32"]],
      ["i32"],
      [
        ir.block("done", [
          ir.loop("again", [
            ir.brIf("done", ir.op("i32.gt_s", ir.get("i"), ir.get("n"))),
            ir.set("total", ir.op("i32.add", ir.get("total"), ir.get("i"))),
            ir.set("i", ir.op("i32.add", ir.get("i"), ir.i32(1))),
            ir.br("again"),
          ]),
        ]),
        ir.get("total"),
      ],
      { locals: [{ name: "i", type: "i32" }, { name: "total", type: "i32" }] },
    );
    const exports = build(withFunctions({ ...sum, body: [ir.set("i", ir.i32(1)), ...sum.body] })) as Record<string, (n: number) => number>;
    expect(exports.sum?.(10)).toBe(55);
    expect(exports.sum?.(0)).toBe(0);
    expect(exports.sum?.(100000)).toBe(705082704); // wraps like a Java int
  });

  it("jumps out of nested blocks to the label it names, however deep", () => {
    const f = fn(
      "find",
      [["n", "i32"]],
      ["i32"],
      [
        ir.block("outer", [
          ir.block("middle", [
            ir.block("inner", [ir.brIf("inner", ir.op("i32.eq", ir.get("n"), ir.i32(1))), ir.brIf("middle", ir.op("i32.eq", ir.get("n"), ir.i32(2))), ir.br("outer")]),
            ir.return(ir.i32(10)),
          ]),
          ir.return(ir.i32(20)),
        ]),
        ir.i32(30),
      ],
    );
    const exports = build(withFunctions(f)) as Record<string, (n: number) => number>;
    expect(exports.find?.(1)).toBe(10);
    expect(exports.find?.(2)).toBe(20);
    expect(exports.find?.(3)).toBe(30);
  });

  it("if and else, with a value", () => {
    const exports = build(
      withFunctions(
        fn("max", [["a", "i32"], ["b", "i32"]], ["i32"], [ir.if(ir.op("i32.gt_s", ir.get("a"), ir.get("b")), [ir.get("a")], [ir.get("b")], "i32")]),
        fn("sign", [["a", "i32"]], ["i32"], [ir.if(ir.op("i32.lt_s", ir.get("a"), ir.i32(0)), [ir.return(ir.i32(-1))]), ir.if(ir.op("i32.gt_s", ir.get("a"), ir.i32(0)), [ir.return(ir.i32(1))]), ir.i32(0)]),
      ),
    ) as Record<string, (...args: number[]) => number>;
    expect(exports.max?.(3, 9)).toBe(9);
    expect(exports.max?.(9, 3)).toBe(9);
    expect([-5, 0, 7].map((n) => exports.sign?.(n))).toEqual([-1, 0, 1]);
  });

  it("br_table picks a branch by number, like a switch", () => {
    const f = fn("pick", [["n", "i32"]], ["i32"], [
      ir.block("c", [ir.block("b", [ir.block("a", [ir.brTable(["a", "b"], "c", ir.get("n"))]), ir.return(ir.i32(100))]), ir.return(ir.i32(200))]),
      ir.i32(300),
    ]);
    const exports = build(withFunctions(f)) as Record<string, (n: number) => number>;
    expect([0, 1, 2, 99].map((n) => exports.pick?.(n))).toEqual([100, 200, 300, 300]);
  });

  it("calls another function, recursively", () => {
    const fib = fn("fib", [["n", "i32"]], ["i32"], [
      ir.if(ir.op("i32.lt_s", ir.get("n"), ir.i32(2)), [ir.return(ir.get("n"))]),
      ir.op("i32.add", ir.call("fib", ir.op("i32.sub", ir.get("n"), ir.i32(1))), ir.call("fib", ir.op("i32.sub", ir.get("n"), ir.i32(2)))),
    ]);
    const exports = build(withFunctions(fib)) as Record<string, (n: number) => number>;
    expect(exports.fib?.(20)).toBe(6765);
  });

  it("calls a function declared after the one that calls it", () => {
    const exports = build(withFunctions(fn("first", [], ["i32"], [ir.call("second")]), fn("second", [], ["i32"], [ir.i32(7)]))) as Record<string, () => number>;
    expect(exports.first?.()).toBe(7);
  });

  it("local.tee, select, drop and unreachable", () => {
    const exports = build(
      withFunctions(
        fn("twice", [["n", "i32"]], ["i32"], [ir.op("i32.add", ir.tee("t", ir.op("i32.mul", ir.get("n"), ir.i32(3))), ir.get("t"))], { locals: [{ name: "t", type: "i32" }] }),
        fn("choose", [["c", "i32"]], ["i32"], [ir.select(ir.i32(11), ir.i32(22), ir.get("c"))]),
        fn("ignore", [], ["i32"], [ir.drop(ir.i32(5)), ir.i32(6)]),
        fn("boom", [], [], [ir.unreachable()]),
      ),
    ) as Record<string, (...args: number[]) => number>;
    expect(exports.twice?.(4)).toBe(24);
    expect([1, 0].map((c) => exports.choose?.(c))).toEqual([11, 22]);
    expect(exports.ignore?.()).toBe(6);
    expect(() => exports.boom?.()).toThrow(WebAssembly.RuntimeError);
  });

  it("keeps locals of different types in the order they were declared", () => {
    const f = fn("mixed", [["a", "f64"]], ["f64"], [
      ir.set("x", ir.i32(2)),
      ir.set("y", ir.op("f64.mul", ir.get("a"), ir.f64(10))),
      ir.set("z", ir.i32(3)),
      ir.op("f64.add", ir.get("y"), ir.op("f64.convert_i32_s", ir.op("i32.add", ir.get("x"), ir.get("z")))),
    ], { locals: [{ name: "x", type: "i32" }, { name: "y", type: "f64" }, { name: "z", type: "i32" }] });
    const exports = build(withFunctions(f)) as Record<string, (a: number) => number>;
    expect(exports.mixed?.(1.5)).toBe(20);
  });
});

describe("memory, data, globals, tables and imports", () => {
  it("has memory the host can read, filled from a data segment", () => {
    const module: Module = {
      ...emptyModule,
      memory: { min: 1 },
      data: [{ offset: 16, bytes: new TextEncoder().encode("hello") }],
      functions: [fn("at", [["i", "i32"]], ["i32"], [ir.load("i32.load8_u", ir.get("i"))])],
    };
    const exports = build(module) as { at: (i: number) => number; memory: WebAssembly.Memory };
    expect(exports.at(16)).toBe("h".charCodeAt(0));
    expect(exports.at(20)).toBe("o".charCodeAt(0));
    expect(new TextDecoder().decode(new Uint8Array(exports.memory.buffer, 16, 5))).toBe("hello");
  });

  it("stores and loads ints, floats and 16-bit units, with an offset", () => {
    const module: Module = {
      ...emptyModule,
      memory: { min: 1 },
      functions: [
        fn("roundtrip", [], ["f64"], [
          ir.store("i32.store", ir.i32(8), ir.i32(-5)),
          ir.store("f64.store", ir.i32(16), ir.f64(2.5), 8),
          ir.store("i32.store16", ir.i32(40), ir.i32(0x1234)),
          ir.op("f64.add", ir.op("f64.add", ir.op("f64.convert_i32_s", ir.load("i32.load", ir.i32(8))), ir.load("f64.load", ir.i32(16), 8)), ir.op("f64.convert_i32_s", ir.load("i32.load16_u", ir.i32(40)))),
        ]),
        fn("signed8", [], ["i32"], [ir.store("i32.store8", ir.i32(0), ir.i32(200)), ir.load("i32.load8_s", ir.i32(0))]),
      ],
    };
    const exports = build(module) as Record<string, () => number>;
    expect(exports.roundtrip?.()).toBe(-5 + 2.5 + 0x1234);
    expect(exports.signed8?.()).toBe(-56);
  });

  it("traps when an address is outside the memory", () => {
    const module: Module = { ...emptyModule, memory: { min: 1 }, functions: [fn("far", [], ["i32"], [ir.load("i32.load", ir.i32(65536))])] };
    expect(() => (build(module) as Record<string, () => number>).far?.()).toThrow(WebAssembly.RuntimeError);
  });

  it("grows the memory, and fills and copies it", () => {
    const module: Module = {
      ...emptyModule,
      memory: { min: 1, max: 3 },
      functions: [
        fn("grow", [["pages", "i32"]], ["i32"], [ir.memoryGrow(ir.get("pages"))]),
        fn("size", [], ["i32"], [ir.memorySize()]),
        fn("copy", [], ["i32"], [
          ir.op("memory.fill", ir.i32(100), ir.i32(7), ir.i32(4)),
          ir.op("memory.copy", ir.i32(200), ir.i32(100), ir.i32(4)),
          ir.load("i32.load", ir.i32(200)),
        ]),
      ],
    };
    const exports = build(module) as Record<string, (n?: number) => number>;
    expect(exports.size?.()).toBe(1);
    expect(exports.grow?.(1)).toBe(1); // returns the old size
    expect(exports.size?.()).toBe(2);
    expect(exports.grow?.(5)).toBe(-1); // past the maximum
    expect(exports.copy?.()).toBe(0x07070707);
  });

  it("has globals, mutable and constant, and exports them", () => {
    const module: Module = {
      ...emptyModule,
      globals: [
        { name: "count", type: "i32", mutable: true, init: 5, export: "count" },
        { name: "pi", type: "f64", mutable: false, init: 3.25 },
      ],
      functions: [
        fn("bump", [], ["i32"], [ir.setGlobal("count", ir.op("i32.add", ir.getGlobal("count"), ir.i32(1))), ir.getGlobal("count")]),
        fn("pi", [], ["f64"], [ir.getGlobal("pi")]),
      ],
    };
    const exports = build(module) as { bump: () => number; pi: () => number; count: WebAssembly.Global };
    expect(exports.bump()).toBe(6);
    expect(exports.bump()).toBe(7);
    expect(exports.count.value).toBe(7);
    expect(exports.pi()).toBe(3.25);
  });

  it("dispatches through a table with call_indirect, the way a virtual call does", () => {
    const one: Signature = { params: ["i32"], results: ["i32"] };
    const module: Module = {
      ...emptyModule,
      table: ["double", "negate", "square"],
      functions: [
        fn("double", [["x", "i32"]], ["i32"], [ir.op("i32.mul", ir.get("x"), ir.i32(2))], { export: null }),
        fn("negate", [["x", "i32"]], ["i32"], [ir.op("i32.sub", ir.i32(0), ir.get("x"))], { export: null }),
        fn("square", [["x", "i32"]], ["i32"], [ir.op("i32.mul", ir.get("x"), ir.get("x"))], { export: null }),
        fn("apply", [["slot", "i32"], ["x", "i32"]], ["i32"], [ir.callIndirect(one, ir.get("slot"), ir.get("x"))]),
      ],
    };
    const exports = build(module) as Record<string, (slot: number, x: number) => number>;
    expect([0, 1, 2].map((slot) => exports.apply?.(slot, 7))).toEqual([14, -7, 49]);
    expect(() => exports.apply?.(3, 1)).toThrow(WebAssembly.RuntimeError); // outside the table
  });

  it("a call_indirect with a signature no function has is still encoded", () => {
    const odd: Signature = { params: ["f64", "i32"], results: [] };
    const module: Module = {
      ...emptyModule,
      table: ["noop"],
      functions: [fn("noop", [["a", "f64"], ["b", "i32"]], [], [], { export: null }), fn("go", [], [], [ir.callIndirect(odd, ir.i32(0), ir.f64(1), ir.i32(2))])],
    };
    expect(() => (build(module) as Record<string, () => void>).go?.()).not.toThrow();
  });

  it("calls an import, and runs a start function when it is created", () => {
    const seen: number[] = [];
    const module: Module = {
      ...emptyModule,
      imports: [{ module: "env", field: "log", name: "log", signature: { params: ["i32"], results: [] } }],
      functions: [fn("main", [], [], [ir.call("log", ir.i32(1)), ir.call("log", ir.i32(2))], { export: null })],
      start: "main",
    };
    build(module, { env: { log: (n: number) => seen.push(n) } });
    expect(seen).toEqual([1, 2]);
  });

  it("an import can give back a value", () => {
    const module: Module = {
      ...emptyModule,
      imports: [{ module: "env", field: "answer", name: "answer", signature: { params: [], results: ["f64"] } }],
      functions: [fn("ask", [], ["f64"], [ir.op("f64.mul", ir.call("answer"), ir.f64(2))])],
    };
    const exports = build(module, { env: { answer: () => 21 } }) as Record<string, () => number>;
    expect(exports.ask?.()).toBe(42);
  });
});

describe("a bug in the compiler is named, not turned into a bad module", () => {
  it("rejects a local that does not exist", () => {
    expect(() => encode(withFunctions(fn("f", [], ["i32"], [ir.get("nope")])))).toThrow(EncodeError);
  });

  it("rejects a jump to a label that is not around it", () => {
    expect(() => encode(withFunctions(fn("f", [], [], [ir.br("nowhere")])))).toThrow(/label named 'nowhere'/);
    expect(() => encode(withFunctions(fn("f", [], [], [ir.block("a", []), ir.br("a")])))).toThrow(EncodeError);
  });

  it("rejects a call to a function that does not exist, and a global that does not exist", () => {
    expect(() => encode(withFunctions(fn("f", [], [], [ir.drop(ir.call("ghost"))])))).toThrow(/no function is named 'ghost'/);
    expect(() => encode(withFunctions(fn("f", [], ["i32"], [ir.getGlobal("ghost")])))).toThrow(/no global is named 'ghost'/);
  });

  it("rejects two functions, two locals or two globals with the same name", () => {
    expect(() => encode(withFunctions(fn("f", [], [], []), fn("f", [], [], [])))).toThrow(/two functions are named 'f'/);
    expect(() => encode(withFunctions(fn("f", [["a", "i32"]], [], [], { locals: [{ name: "a", type: "i32" }] })))).toThrow(/two locals named 'a'/);
  });

  it("an operator checks how many operands it is given when it is built", () => {
    expect(() => ir.op("i32.add", ir.i32(1))).toThrow(/takes 2 operands/);
    expect(() => ir.op("f64.sqrt", ir.f64(1), ir.f64(2))).toThrow(/takes 1 operands/);
  });

  it("the engine rejects a module whose types do not fit, which is why it is the independent check", () => {
    const wrong = withFunctions(fn("f", [], ["i32"], [ir.f64(1)]));
    expect(WebAssembly.validate(encode(wrong))).toBe(false);
  });
});
