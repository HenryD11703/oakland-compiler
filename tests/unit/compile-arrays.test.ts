import { describe, expect, it } from "vitest";
import { compile, runCompiled } from "../../src/core/compile/index";
import { expectSame, expectSameFailure } from "../helpers/differential";

describe("arrays and matrices, compiled and interpreted (S-17)", () => {
  const programs: [string, string][] = [
    ["a list of values, reading, writing, length", `int[] a = {2, 4, 6}; a[1] = 40; System.out.println(a[0], a[1], a[2], a.length);`],
    ["new with a size starts at zero, for every type", `int[] a = new int[3]; float[] f = new float[2]; boolean[] b = new boolean[2]; char[] c = new char[2]; System.out.println(a[0], f[1], b[0], c.length);`],
    ["new string starts with empty strings, not null", `string[] s = new string[3]; System.out.println(s[0] == "", s[2] == null, s.length); System.out.println(s);`],
    ["new of a reference type starts as null", `int[][] m = new int[2][3]; System.out.println(m.length, m[0].length, m[1][2]); string[][] t = new string[2][2]; System.out.println(t[1][1] == "");`],
    ["float arrays take int values", `float[] f = {1, 2.5, 3}; f[0] = 7; f[1] += 1; System.out.println(f[0], f[1], f[2], f);`],
    ["char and boolean arrays", `char[] c = {'a', 'b'}; boolean[] b = {true, false}; c[0] = 'z'; b[1] = !b[1]; System.out.println(c[0], c[1], b[0], b[1], c, b);`],
    ["a matrix with a list and with sizes", `int[][] m = {{1, 2, 3}, {4, 5, 6}}; int[][][] cube = new int[2][2][2]; cube[1][1][1] = 8; m[0][1] += 10; System.out.println(m[0][1], m[1][2], cube[1][1][1], cube[0][0][0], m.length, m[1].length);`],
    ["a ragged matrix", `int[][] r = {{1}, {2, 3}, {}}; System.out.println(r.length, r[0].length, r[1].length, r[2].length, r);`],
    ["elements: ++, --, +=, -= and assignment as a value", `int[] a = {1, 2, 3}; a[0]++; a[1]--; a[2] += 5; a[2] -= 1; int x = (a[0] = 9) + 1; int y; int z; y = z = a[1]; System.out.println(a, x, y, z);`],
    ["string elements join with +=", `string[] s = {"a", "b"}; s[0] += "x"; s[1] += 1; s[1] += 2.5; System.out.println(s[0], s[1]);`],
    ["an int element grows by a float and keeps a float", `float[] f = new float[1]; f[0] += 2; f[0] += 0.5; f[0]++; System.out.println(f[0]);`],
    ["by copy: int[] b = a copies; b = a later shares", `int[] a = {1, 2, 3}; int[] b = a; b[0] = 99; System.out.println(a[0], b[0]); int[] c = {7}; b = c; c[0] = 8; System.out.println(b[0]);`],
    ["by copy goes down into the matrix", `int[][] m = {{1, 2}, {3, 4}}; int[][] c = m; c[0][0] = 99; System.out.println(m[0][0], c[0][0]);`],
    ["var takes the array type and copies", `int[] a = {5, 6}; var b = a; b[1] = 0; System.out.println(a, b);`],
    ["arrays given to a function are shared", `void fill(int[] a, int v) { for (int i = 0; i < a.length; i++) { a[i] = v; } } int[] x = new int[3]; fill(x, 4); System.out.println(x);`],
    ["a function that returns an array", `int[] squares(int n) { int[] r = new int[n]; for (int i = 0; i < n; i++) { r[i] = i * i; } return r; } System.out.println(squares(6), squares(0));`],
    ["a global array used by a function", `int[] data = {3, 1, 2}; int total() { int t = 0; for (int i = 0; i < data.length; i++) { t += data[i]; } return t; } data[0] = 10; System.out.println(total());`],
    ["indexOf, for each element type", `int[] a = {5, 6, 7}; float[] f = {1.5, 2.5}; string[] s = {"a", "b", "c"}; char[] c = {'x', 'y'}; boolean[] b = {false, true}; System.out.println(a.indexOf(7), a.indexOf(1), f.indexOf(2.5), f.indexOf(2), s.indexOf("c"), s.indexOf("z"), c.indexOf('y'), b.indexOf(true));`],
    ["indexOf compares strings by value and finds a null", `string[] s = {"ab", null}; string t = "a" + "b"; System.out.println(s.indexOf(t), s.indexOf(null));`],
    ["indexOf with a number of another type", `float[] f = {1, 2, 3}; int[] i = {1, 2, 3}; char[] c = {'a', 'b'}; System.out.println(f.indexOf(2), i.indexOf(3), c.indexOf('b'));`],
    ["join for each type, empty and nested", `int[] a = {1, 2, 3}; float[] f = {1, 2.5}; string[] s = {"x", null, "z"}; char[] c = {'a', 'b'}; boolean[] b = {true, false}; int[] e = new int[0]; int[][] m = {{1, 2}, {3}}; System.out.println(a.join(), f.join(), s.join(), c.join(), b.join(), "[" + e.join() + "]", m.join());`],
    ["arrays print as [a, b, c]", `int[] a = {1, 2}; float[] f = {1, 2.5}; string[] s = {"x", null}; int[] e = new int[0]; int[] n = null; int[][] m = {{1}, {2, 3}}; System.out.println(a, f, s, e, n, m);`],
    ["an array joins to a string", `int[] a = {1, 2}; string s = "a=" + a; s += a; System.out.println(s, a + "!");`],
    ["for each", `int[] a = {1, 2, 3, 4}; int t = 0; for (int x : a) { t += x; } for (int x : a) { if (x == 2) { continue; } if (x == 4) { break; } t += 100; } System.out.println(t);`],
    ["for each over a matrix, with a float variable and without a type", `int[][] m = {{1, 2}, {3}}; float s = 0; for (int[] row : m) { for (float x : row) { s += x / 2; } } for (var row : m) { s += row.length; } System.out.println(s);`],
    ["for each sees the element as it is when its turn comes", `int[] a = {1, 2, 3}; int seen = 0; for (int x : a) { seen = seen * 10 + x; a[2] = 9; } System.out.println(seen);`],
    ["for each over strings", `string[] w = {"a", "b", "c"}; string r = ""; for (string x : w) { r = x + r; } System.out.println(r);`],
    ["a compound assignment reads its place after the value is worked out", `int x = 1; int bump() { x = 10; return 5; } x += bump(); System.out.println(x); int[] a = {1}; int bump2() { a[0] = 10; return 5; } a[0] += bump2(); System.out.println(a[0]);`],
    ["the elements of println are worked out before any is written", `int n = 0; string tick(string s) { System.out.println("tick " + s); n++; return s; } System.out.println(tick("a"), n, tick("b"), n);`],
    ["a sieve", `int n = 100; boolean[] composite = new boolean[n + 1]; int count = 0; for (int i = 2; i <= n; i++) { if (!composite[i]) { count++; for (int j = i * i; j <= n; j += i) { composite[j] = true; } } } System.out.println(count);`],
    ["a big array makes the memory grow", `int[] a = new int[500000]; for (int i = 0; i < a.length; i++) { a[i] = i; } System.out.println(a[499999], a.length);`],
    ["floats in a big array", `float[] f = new float[100000]; for (int i = 0; i < f.length; i++) { f[i] = i / 4.0; } float t = 0; for (float x : f) { t += x; } System.out.println(t, f[99999]);`],
    ["a table of strings", `string[][] t = {{"a", "b"}, {"c"}}; t[1][0] += "!"; System.out.println(t, t[1][0], t.join());`],
    ["arrays in the ternary and as values", `int[] a = {1}; int[] b = {2, 3}; int[] c = a.length > 1 ? a : b; System.out.println(c, c == b, c == a, a != null);`],
  ];

  it.each(programs)("%s", (_name, source) => {
    expectSame(source);
  });

  it("prints what is expected, not only what the interpreter prints", () => {
    expectSame(`int[] a = {2, 4, 6, 8, 10}; System.out.println(a, a.join(), a.indexOf(8), a.length);`, "[2, 4, 6, 8, 10] 2, 4, 6, 8, 10 3 5\n");
    expectSame(`string[] s = new string[2]; float[] f = {1, 2.5}; System.out.println(s, f);`, "[, ] [1.0, 2.5]\n");
  });

  it("a program that uses no array carries none of the array code", () => {
    expect(compile(`int a = 1; System.out.println("x" + a);`).wat).not.toContain("elem_addr");
    expect(compile(`int[] a = {1}; System.out.println(a[0]);`).wat).toContain("rt:elem_addr");
  });

  it("the sample programs of the course that use arrays run the same", () => {
    // They are also in the corpus test; named here because they are what the task was asked to make work.
    expectSame(`int[] numerosPares = {2, 4, 6, 8, 10}; int[] copiaPares = numerosPares; numerosPares[2] = 20; System.out.println(numerosPares[2], copiaPares[2]); int[][][] matriz = {{ {1, 2}, {3, 4}}, {{5, 6}, {7, 8}}}; System.out.println(matriz[1][0][1], numerosPares.indexOf(10), copiaPares.join());`, "20 6\n6 4 2, 4, 6, 8, 10\n");
  });
});

describe("array mistakes end a compiled run with the interpreter's words and place (S-18)", () => {
  it("an index out of range, above and below", () => {
    expectSameFailure(`int[] a = {1, 2, 3};\nSystem.out.println("before");\nSystem.out.println(a[3]);`, "index 3 is out of range for an array of length 3");
    expectSameFailure(`int[] a = {1, 2, 3};\nint i = -1;\nSystem.out.println(a[i]);`, "index -1 is out of range for an array of length 3");
    expectSameFailure(`int[][] m = {{1}, {2}};\nm[1][5] = 0;`, "index 5 is out of range for an array of length 1");
    expectSameFailure(`int[] a = new int[0];\na[0]++;`, "index 0 is out of range for an array of length 0");
  });

  it("the place of an out-of-range index is the index", () => {
    const ran = runCompiled(compile(`int[] a = {1};\nSystem.out.println(a[7]);`));
    expect(ran.diagnostics[0]?.span.start).toMatchObject({ line: 2, column: 22 });
  });

  it("indexing, measuring, looping over and joining null", () => {
    expectSameFailure(`int[] a = null;\nSystem.out.println(a[0]);`, "cannot index null");
    expectSameFailure(`int[] a = null;\na[0] = 1;`, "cannot index null");
    expectSameFailure(`int[] a = null;\nSystem.out.println(a.length);`, "cannot read length of null");
    expectSameFailure(`int[] a = null;\nfor (int x : a) { System.out.println(x); }`, "cannot loop over null");
    expectSameFailure(`int[] a = null;\nSystem.out.println(a.join());`, "cannot call join on null");
    expectSameFailure(`int[] a = null;\nSystem.out.println(a.indexOf(1));`, "cannot call indexOf on null");
    expectSameFailure(`int[][] m = new int[2][2];\nm = null;\nSystem.out.println(m[0][0]);`, "cannot index null");
  });

  it("a negative size, whichever dimension has it", () => {
    expectSameFailure(`int n = -2;\nint[] a = new int[n];`, "an array size cannot be negative (-2)");
    expectSameFailure(`int[][] m = new int[3][-1];`, "an array size cannot be negative (-1)");
  });

  it("an array too large for the memory ends with out of memory", () => {
    const ran = runCompiled(compile(`System.out.println("start");\nint[] a = new int[1000000000];\nSystem.out.println("not here");`));
    expect(ran.stdout).toBe("start\n");
    expect(ran.diagnostics[0]?.message).toBe("out of memory");
    expect(ran.diagnostics[0]?.span.start.line).toBe(2);
  });
});
