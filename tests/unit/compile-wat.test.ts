import { describe, expect, it } from "vitest";
import { emptyModule, ir, type Func, type Module } from "../../src/core/compile/ir";
import { printWat } from "../../src/core/compile/wat";

const fn = (name: string, params: [string, "i32" | "f64"][], results: ("i32" | "f64")[], body: Func["body"], extra: Partial<Func> = {}): Func => ({
  name,
  params: params.map(([n, type]) => ({ name: n, type })),
  results,
  locals: [],
  body,
  ...extra,
});

const only = (func: Func): Module => ({ ...emptyModule, functions: [func] });

describe("the text format of a module (T44)", () => {
  it("prints an empty module", () => {
    expect(printWat(emptyModule)).toBe("(module\n)\n");
  });

  it("prints a function in the folded style a person would write", () => {
    const add = fn("add", [["a", "i32"], ["b", "i32"]], ["i32"], [ir.op("i32.add", ir.get("a"), ir.get("b"))], { export: "add" });
    expect(printWat(only(add))).toBe(
      ["(module", '  (func $add (export "add") (param $a i32) (param $b i32) (result i32)', "    (i32.add (local.get $a) (local.get $b)))", ")", ""].join("\n"),
    );
  });

  it("prints blocks, loops and jumps with their labels and indentation", () => {
    const sum = fn(
      "sum",
      [["n", "i32"]],
      ["i32"],
      [
        ir.set("i", ir.i32(1)),
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
    expect(printWat(only(sum))).toBe(
      [
        "(module",
        "  (func $sum (param $n i32) (result i32)",
        "    (local $i i32) (local $total i32)",
        "    (local.set $i (i32.const 1))",
        "    (block $done",
        "      (loop $again",
        "        (br_if $done (i32.gt_s (local.get $i) (local.get $n)))",
        "        (local.set $total (i32.add (local.get $total) (local.get $i)))",
        "        (local.set $i (i32.add (local.get $i) (i32.const 1)))",
        "        (br $again)))",
        "    (local.get $total))",
        ")",
        "",
      ].join("\n"),
    );
  });

  it("prints if with then and else, with and without a result", () => {
    const text = printWat(only(fn("max", [["a", "i32"], ["b", "i32"]], ["i32"], [ir.if(ir.op("i32.gt_s", ir.get("a"), ir.get("b")), [ir.get("a")], [ir.get("b")], "i32")])));
    expect(text).toContain("(if (result i32)");
    expect(text).toContain("(then\n");
    expect(text).toContain("(else\n");
    const noElse = printWat(only(fn("f", [["a", "i32"]], [], [ir.if(ir.get("a"), [ir.nop()])])));
    expect(noElse).toContain("(if\n");
    expect(noElse).not.toContain("(else");
  });

  it("prints memory, data, globals, the table, imports and the start function", () => {
    const module: Module = {
      imports: [{ module: "env", field: "print", name: "print", signature: { params: ["i32", "i32"], results: [] } }],
      memory: { min: 1, max: 16 },
      globals: [{ name: "heap", type: "i32", mutable: true, init: 1024 }, { name: "half", type: "f64", mutable: false, init: 0.5, export: "half" }],
      table: ["a", "b"],
      data: [{ offset: 8, bytes: new TextEncoder().encode('say "hi"\n') }],
      functions: [fn("a", [], [], []), fn("b", [], [], [])],
      start: "a",
    };
    expect(printWat(module)).toBe(
      [
        "(module",
        '  (import "env" "print" (func $print (param i32 i32)))',
        '  (memory (export "memory") 1 16)',
        "  (global $heap (mut i32) (i32.const 1024))",
        '  (global $half (export "half") f64 (f64.const 0.5))',
        "  (table 2 funcref)",
        "  (elem (i32.const 0) $a $b)",
        '  (data (i32.const 8) "say \\22hi\\22\\0a")',
        "  (func $a)",
        "  (func $b)",
        "  (start $a)",
        ")",
        "",
      ].join("\n"),
    );
  });

  it("prints loads, stores and the immediates of a memory operation", () => {
    const text = printWat(only(fn("m", [], [], [ir.store("i32.store", ir.i32(0), ir.load("i32.load", ir.i32(4), 8), 4), ir.drop(ir.memoryGrow(ir.i32(1))), ir.op("memory.fill", ir.i32(0), ir.i32(0), ir.i32(8))])));
    expect(text).toContain("(i32.store offset=4 (i32.const 0) (i32.load offset=8 (i32.const 4)))");
    expect(text).toContain("(drop (memory.grow (i32.const 1)))");
    expect(text).toContain("(memory.fill (i32.const 0) (i32.const 0) (i32.const 8))");
  });

  it("prints calls, indirect calls, br_table, select and return", () => {
    const text = printWat(
      only(
        fn("c", [["n", "i32"]], ["i32"], [
          ir.drop(ir.call("c", ir.get("n"))),
          ir.drop(ir.callIndirect({ params: ["i32"], results: ["i32"] }, ir.i32(0), ir.i32(3))),
          ir.block("x", [ir.brTable(["x"], "x", ir.get("n"))]),
          ir.return(ir.select(ir.i32(1), ir.i32(2), ir.get("n"))),
        ]),
      ),
    );
    expect(text).toContain("(drop (call $c (local.get $n)))");
    expect(text).toContain("(call_indirect (param i32) (result i32) (i32.const 3) (i32.const 0))");
    expect(text).toContain("(br_table $x $x (local.get $n))");
    expect(text).toContain("(return (select (i32.const 1) (i32.const 2) (local.get $n)))");
  });

  it("prints special floats the way the format spells them", () => {
    const text = printWat(only(fn("f", [], [], [ir.drop(ir.f64(Number.NaN)), ir.drop(ir.f64(Number.POSITIVE_INFINITY)), ir.drop(ir.f64(Number.NEGATIVE_INFINITY)), ir.drop(ir.f64(-0)), ir.drop(ir.f64(1.5))])));
    expect(text).toContain("(f64.const nan)");
    expect(text).toContain("(f64.const inf)");
    expect(text).toContain("(f64.const -inf)");
    expect(text).toContain("(f64.const -0)");
    expect(text).toContain("(f64.const 1.5)");
  });

  it("turns a name the format would not accept into one it does", () => {
    const text = printWat(only(fn("Dog sound()", [["my var", "i32"]], [], [ir.drop(ir.get("my var"))])));
    expect(text).toContain("(func $Dog_sound__ (param $my_var i32)");
    expect(text).toContain("(local.get $my_var)");
  });

  it("breaks a long expression over several lines, with the operands one level in", () => {
    let e = ir.i32(1);
    for (let i = 0; i < 12; i++) e = ir.op("i32.add", e, ir.op("i32.mul", ir.get("a_rather_long_name"), ir.i32(i)));
    const text = printWat(only(fn("long", [["a_rather_long_name", "i32"]], ["i32"], [e])));
    const lines = text.split("\n");
    expect(Math.max(...lines.map((line) => line.length))).toBeLessThan(120);
    expect(text).toContain("(i32.add\n");
    expect(text.split("(").length).toBe(text.split(")").length); // the parentheses balance
  });

  it("always balances its parentheses", () => {
    const text = printWat({
      ...emptyModule,
      functions: [
        fn("f", [["n", "i32"]], ["i32"], [
          ir.block("b", [ir.loop("l", [ir.if(ir.get("n"), [ir.br("b")], [ir.br("l")])])]),
          ir.block("empty", []),
          ir.i32(0),
        ]),
      ],
    });
    expect(text.split("(").length).toBe(text.split(")").length);
  });
});
