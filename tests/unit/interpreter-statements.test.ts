import { describe, expect, it } from "vitest";
import { out, problems, runOak } from "../helpers/run";

describe("declarations (AC-08, AC-09, AC-10)", () => {
  it("declares typed variables with and without a value", () => {
    expect(out('int a = 10; float b = 20.5; string c = "hi"; char d = \'x\'; boolean e = true; System.out.println(a, b, c, d, e);')).toBe(
      "10 20.5 hi x true",
    );
  });

  it("gives a variable declared without a value the value null", () => {
    expect(out("int a; float b; string c; boolean d; char e; System.out.println(a, b, c, d, e);")).toBe("null null null null null");
  });

  it("lets null variables be assigned later", () => {
    expect(out("int n; n = 4; System.out.println(n);")).toBe("4");
  });

  it("infers the type with var", () => {
    expect(out("var a = 10; var b = 20.5; var c = \"s\"; var d = 'x'; System.out.println(typeof a, typeof b, typeof c, typeof d);")).toBe(
      "int float string char",
    );
  });

  it("stores an int in a float variable as a float", () => {
    expect(out("float f = 3; System.out.println(f, typeof f);")).toBe("3.0 float");
  });

  it("stores a char in an int variable as its code", () => {
    expect(out("int c = 'a'; System.out.println(c);")).toBe("97");
  });

  it("keeps the first declaration when a name is declared twice in a scope", () => {
    const result = runOak("int a = 10; int a = 20; System.out.println(a);");
    expect(result.stdout).toBe("10\n");
    expect(result.diagnostics.map((d) => [d.message, d.span.start.line, d.span.start.column])).toEqual([
      ["'a' is already declared in this scope", 1, 17],
    ]);
  });

  it("allows the same name in an inner scope", () => {
    expect(out("int b = 10; { int b = 20; System.out.println(b); } System.out.println(b);")).toBe("20\n10");
  });

  it("rejects a value of the wrong type, once, and leaves the variable null", () => {
    const result = runOak('int a = "Hola"; System.out.println(a);');
    expect(result.diagnostics.map((d) => d.message)).toEqual(["cannot assign string to int"]);
    expect(result.stdout).toBe("null\n");
  });

  it("does not allow narrowing", () => {
    expect(problems("int a = 3.5;")).toEqual(["cannot assign float to int"]);
    expect(problems("char c = 65;")).toEqual(["cannot assign int to char"]);
  });

  it("rejects an unknown type and a var from null", () => {
    expect(problems("Foo f;")).toEqual(["unknown type 'Foo'"]);
    expect(problems("var x = null;")).toEqual(["cannot infer the type of 'x' from null"]);
  });

  it("does not use a variable inside its own initializer", () => {
    expect(problems("int x = x + 1;")).toEqual(["variable 'x' is not declared"]);
  });
});

describe("assignment", () => {
  it("assigns and chains", () => {
    expect(out("int a; int b; a = b = 3; System.out.println(a, b);")).toBe("3 3");
  });

  it("assigns an inner variable of an outer scope", () => {
    expect(out("int c = 10; int d = 10; { int d = 20; c = 30; d = 30; } System.out.println(c, d);")).toBe("30 10");
  });

  it("widens int to float and char to int", () => {
    expect(out("float f = 1.5; f = 2; System.out.println(f); int i = 0; i = 'b'; System.out.println(i);")).toBe("2.0\n98");
  });

  it("keeps null in the variable when the type is wrong, like the course says", () => {
    const result = runOak('var s = "Hola"; s = 10; System.out.println(s);');
    expect(result.diagnostics.map((d) => d.message)).toEqual(["cannot assign int to string"]);
    expect(result.stdout).toBe("null\n");
  });

  it("recovers when a good value is assigned after a failed one", () => {
    const result = runOak('int a = "x"; a = 5; System.out.println(a);');
    expect(result.diagnostics).toHaveLength(1);
    expect(result.stdout).toBe("5\n");
  });

  it("reports an undeclared variable at each use", () => {
    expect(problems("x = 5; System.out.println(x);")).toEqual(["variable 'x' is not declared", "variable 'x' is not declared"]);
    expect(problems("x = 5;")).toEqual(["variable 'x' is not declared"]);
  });

  it("supports += and -= on numbers and strings", () => {
    expect(out('int i = 1; i += 4; i -= 2; System.out.println(i); string s = "a"; s += "b"; s += 1; System.out.println(s);')).toBe("3\nab1");
    expect(out("float f = 1; f += 1; System.out.println(f);")).toBe("2.0");
  });

  it("does not narrow with +=", () => {
    expect(problems("int i = 1; i += 1.5;")).toEqual(["cannot assign float to int"]);
  });
});

describe("++ and -- (AC-06)", () => {
  it("changes variables, elements and fields", () => {
    expect(
      out(
        "int i = 1; i++; i++; i--; System.out.println(i);" +
          "int[] a = {5}; a[0]++; a[0]++; System.out.println(a[0]);" +
          "float f = 1.5; f++; System.out.println(f);",
      ),
    ).toBe("2\n7\n2.5");
  });

  it("wraps like a 32-bit int", () => {
    expect(out("int i = 2147483647; i++; System.out.println(i);")).toBe("-2147483648");
  });

  it("works as the update of a for loop", () => {
    expect(out("for (int i = 0; i < 3; i++) { System.out.println(i); }")).toBe("0\n1\n2");
    expect(out("for (int i = 3; i > 0; i--) { System.out.println(i); }")).toBe("3\n2\n1");
  });

  it("is an error on values that are not numbers or are null", () => {
    expect(problems('string s = "a"; s++;')).toEqual(["'++' needs an int or a float, but this is string"]);
    expect(problems("int n; n++;")).toEqual(["cannot apply '++' to null"]);
  });
});

describe("if", () => {
  it("runs the right branch", () => {
    expect(out('if (true) { System.out.println("a"); } else { System.out.println("b"); }')).toBe("a");
    expect(out('if (false) { System.out.println("a"); } else if (false) { System.out.println("b"); } else { System.out.println("c"); }')).toBe("c");
    expect(out('if (false) System.out.println("a"); System.out.println("after");')).toBe("after");
  });

  it("needs a boolean condition and skips the statement otherwise", () => {
    const result = runOak('if (1) { System.out.println("yes"); } else { System.out.println("no"); } System.out.println("next");');
    expect(result.diagnostics.map((d) => d.message)).toEqual(["the condition must be boolean, but it is int"]);
    expect(result.stdout).toBe("next\n");
  });

  it("stays silent when the condition already failed", () => {
    expect(problems("if (1 / 0 > 0) { }")).toEqual(["division by zero"]);
  });
});

describe("loops", () => {
  it("runs while", () => {
    expect(out("int i = 0; while (i < 3) { System.out.println(i); i = i + 1; }")).toBe("0\n1\n2");
  });

  it("runs for with a scoped counter", () => {
    expect(out("for (int i = 0; i < 2; i += 1) { } for (int i = 5; i < 6; i += 1) { System.out.println(i); }")).toBe("5");
  });

  it("supports break and continue", () => {
    expect(out("int c = 0; while (true) { System.out.println(c); c = c + 1; if (c == 3) { break; } }")).toBe("0\n1\n2");
    expect(out("for (int i = 0; i < 5; i += 1) { if (i == 2) { continue; } System.out.println(i); }")).toBe("0\n1\n3\n4");
    expect(out("int c = 0; while (c < 6) { if (c % 2 == 0) { c = c + 1; continue; } System.out.println(c); c = c + 1; }")).toBe("1\n3\n5");
  });

  it("only breaks the innermost loop", () => {
    expect(out("for (int i = 0; i < 2; i++) { for (int j = 0; j < 5; j++) { if (j == 1) { break; } System.out.println(i, j); } }")).toBe("0 0\n1 0");
  });

  it("walks a for-each", () => {
    expect(out("int[] a = {1, 2, 3}; for (int v : a) { System.out.println(v); }")).toBe("1\n2\n3");
    expect(out("string[] a = {\"x\", \"y\"}; for (var s : a) { System.out.println(s); }")).toBe("x\ny");
    expect(out("int[][] m = {{1, 2}, {3}}; for (int[] row : m) { for (int v : row) { System.out.println(v); } }")).toBe("1\n2\n3");
    expect(out("int[] a = {1, 2}; for (float f : a) { System.out.println(f); }")).toBe("1.0\n2.0");
  });

  it("checks the for-each header", () => {
    expect(problems("int x = 1; for (int v : x) { }")).toEqual(["a for-each loop needs an array, but this is int"]);
    expect(problems('string[] a = {"x"}; for (int v : a) { }')).toEqual(["the loop variable is int, but the elements are string"]);
    expect(problems("int[] a; for (int v : a) { }")).toEqual(["cannot loop over null"]);
  });

  it("stops a loop whose condition fails, with one diagnostic", () => {
    expect(problems("int i = 0; while (i) { i++; }")).toEqual(["the condition must be boolean, but it is int"]);
  });
});

describe("switch", () => {
  const program = (value: string, extra = ""): string =>
    `int d = ${value}; switch (d) { case 1: System.out.println("one"); break; case 2: System.out.println("two"); ${extra} default: System.out.println("other"); }`;

  it("runs the matching case and stops at break", () => {
    expect(out(program("1"))).toBe("one");
  });

  it("falls through to the following cases and to default", () => {
    expect(out(program("2"))).toBe("two\nother");
  });

  it("stops a fall-through at break", () => {
    expect(out(program("2", "break;"))).toBe("two");
  });

  it("runs default when nothing matches", () => {
    expect(out(program("9"))).toBe("other");
  });

  it("does nothing when nothing matches and there is no default", () => {
    expect(out('int d = 9; switch (d) { case 1: System.out.println("one"); }')).toBe("");
  });

  it("groups several cases", () => {
    expect(out('int d = 3; switch (d) { case 1: case 2: case 3: System.out.println("weekday"); break; default: System.out.println("x"); }')).toBe("weekday");
  });

  it("switches on strings and characters", () => {
    expect(out('string s = "b"; switch (s) { case "a": System.out.println(1); break; case "b": System.out.println(2); break; }')).toBe("2");
    expect(out("char c = 'x'; switch (c) { case 'x': System.out.println(1); }")).toBe("1");
  });

  it("lets continue pass through to the enclosing loop", () => {
    expect(out("for (int i = 0; i < 3; i++) { switch (i) { case 1: continue; } System.out.println(i); }")).toBe("0\n2");
  });

  it("reports a case of another type", () => {
    expect(problems('int d = 1; switch (d) { case "a": break; }')).toEqual(["cannot compare int with string"]);
  });
});

describe("misplaced break, continue and return (AC-12)", () => {
  it.each([
    ["break;", "'break' is only allowed inside a loop or a switch"],
    ["continue;", "'continue' is only allowed inside a loop"],
    ["return;", "'return' is only allowed inside a function"],
    ["if (true) { break; }", "'break' is only allowed inside a loop or a switch"],
    ["switch (1) { case 1: continue; }", "'continue' is only allowed inside a loop"],
    ["void f() { while (true) { } } break;", "'break' is only allowed inside a loop or a switch"],
    ["while (true) { int f() { break; } break; }", "'break' is only allowed inside a loop or a switch"],
    ["return 5;", "'return' is only allowed inside a function"],
  ])("%s", (source, message) => {
    const result = runOak(source);
    expect(result.diagnostics.map((d) => [d.phase, d.message])).toEqual([["semantic", message]]);
  });

  it("is found even in code that never runs", () => {
    expect(problems("if (false) { break; }")).toEqual(["'break' is only allowed inside a loop or a switch"]);
  });

  it("does not stop the rest of the program", () => {
    const result = runOak('break; System.out.println("still here");');
    expect(result.stdout).toBe("still here\n");
  });

  it("accepts the legal placements", () => {
    expect(problems("int f() { return 1; } while (true) { break; } switch (1) { case 1: break; }")).toEqual([]);
  });
});

describe("println", () => {
  it("separates arguments with a space and ends the line", () => {
    expect(out('System.out.println("hola", 10); System.out.println(true); System.out.println();')).toBe("hola 10\ntrue\n");
  });

  it("prints a failed argument as null", () => {
    const result = runOak("System.out.println(nope);");
    expect(result.stdout).toBe("null\n");
    expect(result.diagnostics.map((d) => d.message)).toEqual(["variable 'nope' is not declared"]);
  });
});
