import { describe, expect, it } from "vitest";
import { compile } from "../../src/core/compile/index";
import { expectSame, expectSameFailure } from "../helpers/differential";

describe("int, float, char and boolean, compiled and interpreted (S-17, S-19)", () => {
  const programs: [string, string, string][] = [
    ["int arithmetic", "System.out.println(2 + 3, 7 - 10, 6 * 7, 7 / 2, -7 / 2, 7 % 3, -7 % 3, 7 % -3);", "5 -3 42 3 -3 1 -1 1"],
    ["int overflow wraps", "System.out.println(2147483647 + 1, -2147483648 - 1, 100000 * 100000, 65536 * 65536);", "-2147483648 2147483647 1410065408 0"],
    ["the smallest int", "int m = -2147483648; System.out.println(m, m / -1, m % -1, -m, m - 1);", "-2147483648 -2147483648 0 -2147483648 2147483647"],
    ["float arithmetic and its printing", "System.out.println(2.5 * 2, 1.0 / 3.0, 0.1 + 0.2, 10.0 / 4, 5.5 % 2, 10000000.0, 123456789.0, 0.00001);", "5.0 0.3333333333333333 0.30000000000000004 2.5 1.5 1.0E7 1.23456789E8 1.0E-5"],
    ["int and float mix", "int i = 3; float f = 1.5; System.out.println(i + f, i * f, i / 2, i / 2.0, f + i, i > f, i == 3.0);", "4.5 4.5 1 1.5 4.5 true true"],
    ["char is a number in arithmetic", "char c = 'a'; System.out.println(c, c + 1, c + c, 'z' - 'a', c < 'b', c == 97);", "a 98 194 25 true true"],
    ["booleans and short circuit", "boolean t = true; boolean f = false; System.out.println(t && f, t || f, !t, !f, t == f, t != f, f || t && t);", "false true false true false true true"],
    ["the second side of && and || may not run", "int hits = 0; boolean a = false && bump(); boolean b = true || bump(); boolean c = true && bump(); System.out.println(hits, a, b, c); boolean bump() { hits = hits + 1; return true; }", "1 false true true"],
    ["comparisons", "System.out.println(1 < 2, 2 <= 2, 3 > 4, 4 >= 5, 1 == 1, 1 != 1, 1.5 < 2, 'a' < 'b');", "true true false false true false true true"],
    ["compound assignment and ++ --", "int a = 5; a += 3; a -= 1; a++; a--; a++; float f = 1.5; f += 2; f -= 0.5; f++; System.out.println(a, f);", "8 4.0"],
    ["assignment is an expression", "int a; int b; a = b = 4; int c = (a = 7) + 1; System.out.println(a, b, c);", "7 4 8"],
    ["the ternary has one type", "int n = 2; System.out.println(n > 1 ? 1 : 2.5, n > 5 ? 1 : 2.5, n > 1 ? 'a' : 1, n > 1 ? \"yes\" : \"no\");", "1.0 2.5 97 yes"],
    ["unary minus and not", "int a = 5; float f = 2.5; System.out.println(-a, -f, - -a, !(a > 3), -(a + 1));", "-5 -2.5 5 false -6"],
    ["typeof is the declared type", "int i = 1; float f = 1; string s = \"x\"; System.out.println(typeof i, typeof f, typeof s, typeof (i + f), typeof true);", "int float string float boolean"],
    ["strings can be printed, and null", "string s = \"hello\"; string n = null; System.out.println(s, n, \"a\", \"\");", "hello null a "],
    ["a declaration without a value starts again each time", "for (int i = 0; i < 3; i++) { int x; string s; if (i == 1) { x = 5; s = \"set\"; } System.out.println(i, s); }", "0 null\n1 set\n2 null"],
  ];
  it.each(programs)("%s", (_name, source, expected) => {
    expectSame(source, `${expected}\n`);
  });

  const withLines = (...lines: string[]): string => lines.join("\n");

  it("if, else if and else", () => {
    expectSame(
      withLines("int sign(int n) { if (n < 0) { return -1; } else if (n == 0) { return 0; } else { return 1; } }", "System.out.println(sign(-9), sign(0), sign(4));"),
      "-1 0 1\n",
    );
  });

  it("while, for, break and continue", () => {
    expectSame(
      withLines(
        "int total = 0;",
        "for (int i = 0; i < 10; i++) { if (i % 2 == 0) { continue; } if (i > 7) { break; } total += i; }",
        "int n = 0; while (true) { n++; if (n >= 5) { break; } }",
        "int j = 0; while (j < 5) { j++; if (j == 2) { continue; } System.out.println(j); }",
        "System.out.println(total, n);",
      ),
      "1\n3\n4\n5\n16 5\n",
    );
  });

  it("nested loops, with break and continue that mean the inner loop", () => {
    expectSame(
      withLines(
        "int count = 0;",
        "for (int i = 0; i < 4; i++) { for (int j = 0; j < 4; j++) { if (j == 2) { break; } if (i == 1) { continue; } count++; } }",
        "System.out.println(count);",
      ),
      "6\n",
    );
  });

  it("a for loop with its own variable, shadowing, and a variable per block", () => {
    expectSame(
      withLines("int i = 100;", "for (int i = 0; i < 2; i++) { int x = i * 10; { int x = 99; System.out.println(x); } System.out.println(x); }", "System.out.println(i);"),
      "99\n0\n99\n10\n100\n",
    );
  });

  it("switch: the first match, fall-through, break, default", () => {
    expectSame(
      withLines(
        "void show(int k) { switch (k) { case 1: System.out.println(\"one\"); case 2: System.out.println(\"two\"); break; case 3: System.out.println(\"three\"); break; default: System.out.println(\"other\"); } }",
        "show(1); show(2); show(3); show(4);",
        "switch (5) { case 1: System.out.println(\"none\"); }",
        "char c = 'b'; switch (c) { case 'a': System.out.println(\"A\"); break; case 'b': System.out.println(\"B\"); break; }",
        "switch (1) { case 1.0: System.out.println(\"float case\"); }",
      ),
      "one\ntwo\ntwo\nthree\nother\nB\nfloat case\n",
    );
  });

  it("a break inside a switch inside a loop leaves the switch, not the loop", () => {
    expectSame(
      "for (int i = 0; i < 3; i++) { switch (i) { case 1: break; default: System.out.println(i); } System.out.println(\"after\", i); }",
      "0\nafter 0\nafter 1\n2\nafter 2\n",
    );
  });

  it("functions: recursion, mutual recursion, void, early return, several parameters, mixed types", () => {
    expectSame(
      withLines(
        "int fact(int n) { if (n <= 1) { return 1; } return n * fact(n - 1); }",
        "int gcd(int a, int b) { while (b != 0) { int t = a % b; a = b; b = t; } return a; }",
        "boolean even(int n) { if (n == 0) { return true; } return odd(n - 1); }",
        "boolean odd(int n) { if (n == 0) { return false; } return even(n - 1); }",
        "float mean(int a, float b) { return (a + b) / 2; }",
        "void hello(string who) { System.out.println(\"hello\", who); }",
        "float widen(int n) { return n; }",
        "System.out.println(fact(10), gcd(48, 18), even(10), odd(10), mean(3, 4.5), widen(7));",
        "hello(\"world\");",
      ),
      "3628800 6 true false 3.75 7.0\nhello world\n",
    );
  });

  it("hanoi, fibonacci and an Ackermann-style depth", () => {
    expectSame(
      withLines(
        "int moves = 0;",
        "void hanoi(int n, int from, int to, int via) { if (n == 0) { return; } hanoi(n - 1, from, via, to); moves++; hanoi(n - 1, via, to, from); }",
        "int fib(int n) { if (n < 2) { return n; } return fib(n - 1) + fib(n - 2); }",
        "hanoi(10, 1, 3, 2);",
        "System.out.println(moves, fib(22));",
      ),
      "1023 17711\n",
    );
  });

  it("globals are shared by functions; a top-level variable no function uses stays a local", () => {
    expectSame(
      withLines("int counter = 0; int unused = 5; float scale = 2.5;", "void bump(int by) { counter += by; }", "float scaled() { return counter * scale; }", "bump(2); bump(3); unused++;", "System.out.println(counter, scaled(), unused);"),
      "5 12.5 6\n",
    );
  });

  it("a function does not see a local of the code that calls it", () => {
    expectSame("int x = 1; int f(int x) { return x * 2; } { int x = 10; System.out.println(f(3), x); } System.out.println(x);", "6 10\n1\n");
  });

  it("uses a function before its declaration", () => {
    expectSame("System.out.println(twice(4)); int twice(int n) { return n * 2; }", "8\n");
  });

  it("a call used as a statement drops its value", () => {
    expectSame("int f() { return 5; } f(); f(); System.out.println(\"ok\");", "ok\n");
  });
});

describe("runtime mistakes end a compiled run with the interpreter's own words (S-18)", () => {
  it("division by zero, int and float, / and %", () => {
    expectSameFailure("System.out.println(\"before\"); int z = 0; System.out.println(1 / z); System.out.println(\"after\");", "division by zero");
    expectSameFailure("int z = 0; System.out.println(5 % z);", "division by zero");
    expectSameFailure("float z = 0; System.out.println(1.5 / z);", "division by zero");
    expectSameFailure("float z = 0.0; System.out.println(1.5 % z);", "division by zero");
    expectSameFailure("int a = 4; float z = 0; System.out.println(a / z);", "division by zero");
  });

  it("points at the operation that failed, even inside a function called from a loop", () => {
    expectSameFailure("int safe(int a, int b) { return a / b; }\nfor (int i = 3; i >= 0; i--) { System.out.println(safe(12, i)); }", "division by zero");
  });

  it("a run that failed printed only what came before it", () => {
    const source = "System.out.println(\"one\");\nSystem.out.println(\"two\");\nint z = 0;\nSystem.out.println(1 / z);\nSystem.out.println(\"three\");";
    expectSameFailure(source, "division by zero");
  });
});

describe("what the compiler does not translate yet is said, not guessed", () => {
  it("names the construct and where it is", () => {
    const result = compile("int[] a = {1, 2};");
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.message).toBe("a list of values cannot be compiled yet");
    expect(result.diagnostics[0]?.span.start.line).toBe(1);
  });

  it("does not compile a program with type mistakes, and returns them", () => {
    const result = compile("int a = \"x\";");
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((d) => d.message)).toEqual(["cannot assign string to int"]);
    expect(result.wasm).toBeNull();
  });

  it("does not compile a program with syntax mistakes", () => {
    expect(compile("int a = ;").diagnostics[0]?.phase).toBe("syntax");
  });

  it("returns a module the engine accepts, and its text", () => {
    const result = compile("int f(int n) { return n + 1; } System.out.println(f(1));");
    expect(result.ok).toBe(true);
    expect(WebAssembly.validate(result.wasm as Uint8Array<ArrayBuffer>)).toBe(true);
    expect(result.wat).toContain("(func $f (param $n i32) (result i32)");
    expect(result.wat).toContain("(i32.add");
  });
});
