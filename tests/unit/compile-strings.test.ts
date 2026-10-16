import { describe, expect, it } from "vitest";
import { compile, runCompiled } from "../../src/core/compile/index";
import { expectSame } from "../helpers/differential";

describe("strings, compiled and interpreted (S-17, S-19)", () => {
  const programs: [string, string][] = [
    ["joining strings", `string a = "foo"; string b = "bar"; System.out.println(a + b, a + "-" + b, "" + "", a + "");`],
    ["joining a string to every other type", `System.out.println("n=" + 42, "f=" + 2.5, "b=" + true, "c=" + 'x', "z=" + null);`],
    ["the string may be on either side", `System.out.println(1 + "a", 2.5 + "a", false + "a", 'q' + "a", null + "a");`],
    ["left to right: numbers add first, then the string joins", `System.out.println(1 + 2 + "a", "a" + 1 + 2, 'a' + 'b' + "c", "c" + 'a' + 'b');`],
    ["a null string joins as the text null", `string n = null; string s = "x"; System.out.println(n + s, s + n, n + n);`],
    ["ints as text, the edges of the range", `System.out.println("" + 0, "" + 9, "" + 10, "" + 99, "" + 100, "" + 12345, "" + -1, "" + -10, "" + 2147483647, "" + -2147483648, "" + 1000000000);`],
    ["floats as text, as Java shows them", `System.out.println("" + 16.0, "" + 0.1, "" + 10000000.0, "" + 0.000015, "" + (1.0 / 3.0), "" + -2.5, "" + 100.0, "" + 123456789.0);`],
    ["chars as text", `char c = 'A'; System.out.println("" + c, c + "" + c, "x" + c + "y");`],
    ["compound +=", `string s = "a"; s += "b"; s += 1; s += 2.5; s += true; s += 'z'; s += null; System.out.println(s);`],
    ["+= as a value", `string s = "a"; string t = (s += "b"); System.out.println(s, t);`],
    ["equality is by value", `string a = "hello"; string b = "hel" + "lo"; System.out.println(a == b, a != b, a == "hello", a == "Hello", "" == "", a == "hell");`],
    ["equality and null", `string n = null; string m = null; string s = "x"; System.out.println(n == m, n == s, s == n, n != s, s == null, n == null, n != null);`],
    ["ordering is by code unit, then by length", `System.out.println("a" < "b", "b" < "a", "a" < "a", "a" <= "a", "ab" < "b", "ab" > "a", "" < "a", "Z" < "a", "abc" >= "abd", "abc" > "ab");`],
    ["non-ASCII text", `string s = "héllo ñ " + "日本" + "😀"; System.out.println(s, s == "héllo ñ 日本😀", s < "z");`],
    ["a string function and a string global", `string tag = "id"; string label(int n) { return tag + "-" + n; } System.out.println(label(7), label(8) < label(9), label(10) < label(9));`],
    ["a string in the ternary", `int n = 5; string s = n > 3 ? "big" : "small"; System.out.println(s + "!", (n > 9 ? "x" : "y") + (n > 1 ? "p" : "q"));`],
    ["a switch on strings", `string name(string s) { switch (s) { case "a": return "first"; case "b": case "c": return "second or third"; default: return "other"; } } System.out.println(name("a"), name("c"), name("zz"), name("A"));`],
    ["a switch on strings falls through", `string s = "b"; switch (s) { case "a": System.out.println("a"); case "b": System.out.println("b"); case "c": System.out.println("c"); break; default: System.out.println("d"); }`],
    ["building a string in a loop", `string s = ""; for (int i = 0; i < 12; i++) { s = s + i + (i < 11 ? "," : ""); } System.out.println(s);`],
    ["typeof joins like any string", `int i = 1; System.out.println("type: " + typeof i, typeof i + typeof 2.5);`],
  ];

  it.each(programs)("%s", (_name, source) => {
    expectSame(source);
  });

  it("a string that grows past the first page of memory", () => {
    // 2^17 code units is 256 KiB: four pages, so the memory has to grow. Comparing is how to check it without printing it.
    expectSame(`string s = "x"; for (int i = 0; i < 17; i++) { s = s + s; } System.out.println(s == s, s < s + "a", s > "x", s + s == s + s);`);
  });

  it("prints exactly what is expected, not only what the interpreter prints", () => {
    expectSame(`System.out.println("a" + 1 + 2.5 + true + 'c' + null, 1 + 2 + "x");`, "a12.5truecnull 3x\n");
    expectSame(`System.out.println("" + -2147483648, "" + 2147483647, "" + 0, "" + 10000000.0);`, "-2147483648 2147483647 0 1.0E7\n");
  });

  it("the library of runtime functions is only carried when it is used", () => {
    const small = compile(`System.out.println(1 + 2);`);
    expect(small.wat).not.toContain("rt:alloc");
    expect(small.wat).not.toContain("heap");
    const joined = compile(`System.out.println("a" + 1);`);
    expect(joined.wat).toContain("rt:alloc");
    expect(joined.wat).toContain("rt:int_to_str");
    expect(joined.wat).toContain("rt:str_concat");
  });

  it("comparing a null string with < ends the run with the interpreter's wording and place", () => {
    const compiled = compile(`string n = null;\nSystem.out.println("before");\nSystem.out.println(n < "a");\nSystem.out.println("after");`);
    expect(compiled.diagnostics).toEqual([]);
    const ran = runCompiled(compiled);
    expect(ran.stdout).toBe("before\n");
    expect(ran.stoppedEarly).toBe(true);
    expect(ran.diagnostics).toHaveLength(1);
    expect(ran.diagnostics[0]?.message).toBe("cannot apply '<' to null");
    expect(ran.diagnostics[0]?.span.start.line).toBe(3);
  });

  it("a program that needs more than the memory cap ends with out of memory, and keeps its output", () => {
    const compiled = compile(`System.out.println("start");\nstring s = "x";\nwhile (true) { s = s + s; }`);
    expect(compiled.diagnostics).toEqual([]);
    const ran = runCompiled(compiled);
    expect(ran.stdout).toBe("start\n");
    expect(ran.stoppedEarly).toBe(true);
    expect(ran.diagnostics[0]?.message).toBe("out of memory");
    expect(ran.diagnostics[0]?.span.start.line).toBe(3);
  });
});
