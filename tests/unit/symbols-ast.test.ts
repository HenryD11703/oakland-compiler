import { describe, expect, it } from "vitest";
import { countNodes, type AstNode } from "../../src/core/astView";
import { run } from "../../src/core/run";

const symbols = (source: string): string[] =>
  run(source).symbols.map((s) => `${s.kind} ${s.name}: ${s.type} @ ${s.scope} (${s.span.start.line}:${s.span.start.column})`);

describe("symbol table (AC-30)", () => {
  it("lists variables, arrays, functions and structs with type, scope and position", () => {
    expect(
      symbols(
        [
          "int g = 1;",
          "float[] f = {1.5};",
          "struct P { int x; }",
          "P p = P{x: 1};",
          "int add(int a, int b) {",
          "  int sum = a + b;",
          "  return sum;",
          "}",
        ].join("\n"),
      ),
    ).toEqual([
      "variable g: int @ global (1:5)",
      "array f: float[] @ global (2:9)",
      "struct P: P @ global (3:8)",
      "variable p: P @ global (4:3)",
      "function add: int(int, int) @ global (5:5)",
      "variable a: int @ function add (5:13)",
      "variable b: int @ function add (5:20)",
      "variable sum: int @ function add (6:7)",
    ]);
  });

  it("names the nested scope a variable lives in", () => {
    expect(symbols("{ int a = 1; { int b = 2; } }\nfor (int i = 0; i < 1; i++) { int j = i; }")).toEqual([
      "variable a: int @ block (1:7)",
      "variable b: int @ block > block (1:20)",
      "variable i: int @ for (2:10)",
      "variable j: int @ for > block (2:35)",
    ]);
  });

  it("counts a declaration inside a loop once, however many times it runs", () => {
    expect(symbols("for (int i = 0; i < 100; i++) { int square = i * i; }").filter((s) => s.startsWith("variable square"))).toHaveLength(1);
  });

  it("includes the loop variable of a for-each and the parameters, once each", () => {
    const list = symbols("int twice(int n) { return n * 2; } int[] a = {1, 2, 3}; for (int v : a) { twice(v); }");
    expect(list.filter((s) => s.includes(" v:"))).toHaveLength(1);
    expect(list.filter((s) => s.includes(" n:"))).toHaveLength(1);
    expect(list).toContain("variable v: int @ for-each (1:66)");
  });

  it("keeps a variable whose declaration failed, with the type it was declared with", () => {
    expect(symbols('int a = "x";')).toEqual(["variable a: int @ global (1:5)"]);
  });

  it("is empty when the program did not run", () => {
    expect(run("int x = ;").symbols).toEqual([]);
  });
});

describe("syntax tree view (AC-29)", () => {
  const find = (node: AstNode, kind: string): AstNode | undefined =>
    node.kind === kind ? node : node.children.map((c) => find(c, kind)).find((n) => n !== undefined);

  it("draws the program as a tree with kind, label and span", () => {
    const { ast } = run("int x = 1 + 2 * 3;\nSystem.out.println(x);");
    expect(ast.kind).toBe("Program");
    expect(ast.children.map((c) => `${c.kind}: ${c.label}`)).toEqual(["VarDecl: int x", "Print: System.out.println"]);
    const sum = find(ast, "Binary");
    expect(sum?.label).toBe("+");
    expect(sum?.children.map((c) => c.label)).toEqual(["1", "*"]);
    expect(find(ast, "Binary")?.span.start).toMatchObject({ line: 1, column: 9 });
  });

  it("covers every kind of statement and expression", () => {
    const source = `
      struct P { int x; }
      int f(int a) { return a; }
      P p = P{x: 1};
      int[] arr = {1, 2};
      int[][] m = new int[2][2];
      for (int i = 0; i < 2; i++) { if (i == 1) { continue; } else { break; } }
      for (int v : arr) { p.x += v; }
      while (false) { }
      switch (arr[0]) { case 1: arr[0]--; break; default: f(typeof arr); }
      boolean ok = !true && (1 < 2 ? true : false);
      string s = "a" + 'b' + null;
      arr.join();
    `;
    const kinds = new Set<string>();
    const walk = (node: AstNode): void => {
      kinds.add(node.kind);
      node.children.forEach(walk);
    };
    walk(run(source).ast);
    for (const kind of [
      "Program", "StructDecl", "FuncDecl", "VarDecl", "StructLiteral", "ArrayLiteral", "NewArray", "For", "If", "Block", "Continue",
      "Break", "Foreach", "Assign", "Member", "While", "Switch", "Case", "Default", "Update", "Index", "Call", "Unary", "Binary",
      "Group", "Ternary", "Literal", "Identifier", "Return", "ExprStmt",
    ]) {
      expect(kinds, kind).toContain(kind);
    }
  });

  it("is available even when the program has syntax errors, with what could be parsed", () => {
    const { ast, ran } = run("int a = 1;\nint b = ;\nint c = 3;");
    expect(ran).toBe(false);
    expect(ast.children.map((c) => c.label)).toEqual(["int a", "int c"]);
  });

  it("has every child inside its parent's span", () => {
    const { ast } = run("int f(int a) { if (a > 0) { return a * 2; } return 0; } System.out.println(f(3));");
    const check = (node: AstNode): void => {
      for (const child of node.children) {
        expect(child.span.start.offset).toBeGreaterThanOrEqual(node.span.start.offset);
        expect(child.span.end.offset).toBeLessThanOrEqual(node.span.end.offset);
        check(child);
      }
    };
    check(ast);
    expect(countNodes(ast)).toBeGreaterThan(15);
  });
});

describe("symbols of code that never runs", () => {
  it("lists the locals of a function that is never called", () => {
    expect(symbols("void unused(int p) {\n  int local = p;\n}")).toEqual([
      "function unused: void(int) @ global (1:6)",
      "variable p: int @ function unused (1:17)",
      "variable local: int @ function unused (2:7)",
    ]);
  });

  it("lists declarations in a branch that is not taken", () => {
    expect(symbols("if (false) { int hidden = 1; }")).toEqual(["variable hidden: int @ block (1:18)"]);
  });

  it("takes the type of a var from the run when the code ran", () => {
    expect(symbols("var a = 2.5; var b = \"s\"; var c = {1}")).toEqual([]);
    expect(symbols("var a = 2.5; var b = \"s\";")).toEqual(["variable a: float @ global (1:5)", "variable b: string @ global (1:18)"]);
  });
});
