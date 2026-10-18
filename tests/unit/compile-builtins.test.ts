import { describe, expect, it } from "vitest";
import { compile, runCompiled } from "../../src/core/compile/index";
import { expectSame, expectSameFailure } from "../helpers/differential";

describe("the built-in functions, compiled and interpreted (S-17)", () => {
  const programs: [string, string][] = [
    ["parseInt reads whole numbers, signs and spaces", `System.out.println(parseInt("42"), parseInt("-7"), parseInt("+3"), parseInt("  12  "), parseInt("0"), parseInt("007"));`],
    ["parseInt cuts a decimal text, towards zero", `System.out.println(parseInt("3.99"), parseInt("-3.99"), parseInt("2147483647"), parseInt("-2147483648"));`],
    ["parseFloat reads decimals in every spelling the language accepts", `System.out.println(parseFloat("2.5"), parseFloat(".5"), parseFloat("5."), parseFloat("-0.25"), parseFloat("7"), parsefloat(" 1.5 "));`],
    ["parsing feeds arithmetic", `int a = parseInt("40") + 2; float b = parseFloat("1.5") * 2; System.out.println(a, b, a + b);`],
    ["toUpperCase and toLowerCase", `System.out.println(toUpperCase("Hello, World 1"), toLowerCase("Hello, World 1"), toUpperCase(""), toLowerCase("ÁÉÍ"));`],
    ["a case change that changes the length", `System.out.println(toUpperCase("straße"), toLowerCase("İ"));`],
    ["case changes on a variable, joined and compared", `string s = "OakLand"; string t = toLowerCase(s) + "!" + toUpperCase(s); System.out.println(t, toLowerCase(s) == "oakland", s);`],
    ["toString of every type", `System.out.println(toString(42), toString(-1), toString(2.5), toString(7.0), toString('x'), toString(true), toString(false), toString("text"));`],
    ["toString of a null string is the text null", `string s = null; string t = toString(s); System.out.println(t, t == null, t + "!");`],
    ["toString of an object and of a struct", `class P { int x = 3; string n = "a"; } struct S { int v; string w; } System.out.println(toString(new P()), toString(S{v: 1, w: "z"}), toString(new P()) + "|");`],
    ["toString joins like any string", `int n = 5; string s = "n=" + toString(n) + toString(n * 2); System.out.println(s);`],
    ["obtenerLongitudArray", `int[] a = {1, 2, 3}; string[] s = new string[5]; int[][] m = new int[2][4]; System.out.println(obtenerLongitudArray(a), obtenerLongitudArray(s), obtenerLongitudArray(m), obtenerLongitudArray(m[1]));`],
    ["built-ins inside functions, methods and loops", `int total(string[] words) { int t = 0; for (string w : words) { t += parseInt(w); } return t; } class C { string up(string s) { return toUpperCase(s); } } string[] w = {"1", "22", "333"}; System.out.println(total(w), new C().up("abc"));`],
    ["a user function with a built-in's name wins", `int parseInt(string s) { return 99; } System.out.println(parseInt("5"));`],
  ];

  it.each(programs)("%s", (_name, source) => {
    expectSame(source);
  });

  const failures: [string, string, string][] = [
    ["parseInt of text that is not a number", `System.out.println(parseInt("abc"));`, `parseInt cannot convert "abc" to an int`],
    ["parseInt of an empty text", `int n = parseInt("");`, `parseInt cannot convert "" to an int`],
    ["parseInt of a number that does not fit", `int n = parseInt("2147483648");`, `parseInt: "2147483648" does not fit in an int`],
    ["parseInt of a text with an exponent", `int n = parseInt("1e3");`, `parseInt cannot convert "1e3" to an int`],
    ["parseFloat of text that is not a number", `float x = parseFloat("1.2.3");`, `parseFloat cannot convert "1.2.3" to a float`],
    ["parsefloat, spelled the course's way, names itself", `float x = parsefloat("x");`, `parsefloat cannot convert "x" to a float`],
    ["parseInt of a null string", `string s = null; int n = parseInt(s);`, `parseInt expects a string, but got string`],
    ["toUpperCase of a null string", `string s = null; System.out.println(toUpperCase(s));`, `toUpperCase expects a string, but got string`],
    ["toLowerCase of a null string", `string s = null; string t = toLowerCase(s);`, `toLowerCase expects a string, but got string`],
    ["the length of a null array", `int[] a = null; System.out.println(obtenerLongitudArray(a));`, `obtenerLongitudArray received null instead of an array`],
  ];

  it.each(failures)("%s", (_name, source, message) => {
    // The interpreter calls the mistakes of the built-in functions semantic, so the compiled program does too.
    expectSameFailure(source, message, "semantic");
  });

  it("time() is an ISO date, as long as the interpreter's", () => {
    const result = compile(`string t = time(); System.out.println(t);`);
    expect(result.ok).toBe(true);
    const ran = runCompiled(result);
    expect(ran.stdout.trim()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});
