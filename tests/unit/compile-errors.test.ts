import { describe, expect, it } from "vitest";
import { compile, runCompiled } from "../../src/core/compile/index";
import { expectSame, expectSameFailure } from "../helpers/differential";

const OVERFLOW = "stack overflow: more than 400 calls nested inside each other";

/**
 * S-18 and S-20: every kind of runtime mistake ends a compiled run with the first diagnostic the interpreter gives, at
 * the same place, and what was printed before it is kept.
 */
describe("runtime mistakes, compiled and interpreted (S-18, S-20)", () => {
  const failures: [string, string, string][] = [
    ["division by zero, in an int and in a float", `System.out.println("before"); int z = 0; System.out.println(10 / z);`, "division by zero"],
    ["remainder by zero", `int z = 0; System.out.println(7 % z);`, "division by zero"],
    ["an index past the end of an array", `int[] a = {1, 2, 3}; System.out.println(a[3]);`, "index 3 is out of range for an array of length 3"],
    ["a negative index", `int[] a = {1}; a[-1] = 5;`, "index -1 is out of range for an array of length 1"],
    ["an index into null", `int[] a = null; System.out.println(a[0]);`, "cannot index null"],
    ["a negative array size", `int n = -4; int[] a = new int[n];`, "an array size cannot be negative (-4)"],
    ["a field of null", `class A { int n; } A a = null; System.out.println(a.n);`, "cannot read field 'n' of null"],
    ["a method of null", `class A { void m() { } } A a = null; a.m();`, "cannot call m on null"],
    ["an array of more than a million elements", `int[] a = new int[1000001];`, "the array is too large (limit: 1,000,000 elements)"],
    ["a matrix of more than a million elements", `int[][] m = new int[1001][1001];`, "the array is too large (limit: 1,000,000 elements)"],
    ["a size that is negative is reported before one that is too large", `int[][] m = new int[5000][-1];`, "an array size cannot be negative (-1)"],
    ["a function that calls itself for ever", `System.out.println("start"); int f(int n) { return f(n + 1); } f(0);`, OVERFLOW],
    ["a void function that calls itself", `void f() { f(); } f();`, OVERFLOW],
    ["two functions that call each other", `void a(int n) { b(n); } void b(int n) { a(n); } a(1);`, OVERFLOW],
    ["a method that calls itself", `class A { int m(int n) { return m(n + 1); } } System.out.println(new A().m(0));`, OVERFLOW],
    ["a virtual method that calls itself", `class A { int m(int n) { return n; } } class B extends A { int m(int n) { return m(n + 1); } } A a = new B(); a.m(0);`, OVERFLOW],
    ["a constructor that builds the same class for ever", `class A { A() { new A(); } } new A();`, OVERFLOW],
    ["a super call that goes round", `class A { void m() { m(); } } class B extends A { void m() { super.m(); } } new B().m();`, OVERFLOW],
  ];

  it.each(failures)("%s", (_name, source, message) => {
    expectSameFailure(source, message);
  });

  it("the output printed before a mistake is kept", () => {
    const compiled = compile(`System.out.println("one"); System.out.println("two"); int z = 0; System.out.println(1 / z); System.out.println("three");`);
    const ran = runCompiled(compiled);
    expect(ran.stdout).toBe("one\ntwo\n");
    expect(ran.stoppedEarly).toBe(true);
  });

  const fine: [string, string][] = [
    ["400 nested calls are allowed", `int d(int n) { if (n == 0) { return 0; } return 1 + d(n - 1); } System.out.println(d(399));`],
    ["the depth comes back down after a call returns", `int d(int n) { if (n == 0) { return 0; } return 1 + d(n - 1); } int t = 0; for (int i = 0; i < 1000; i++) { t += d(300); } System.out.println(t);`],
    ["calls nested in methods and constructors stay within the count", `class N { N next; N(int d) { if (d > 0) { next = new N(d - 1); } } int depth() { if (next == null) { return 1; } return 1 + next.depth(); } } System.out.println(new N(150).depth());`],
    ["an array of exactly a million elements", `int[] a = new int[1000000]; int[][] m = new int[1000][1000]; System.out.println(a.length, m.length * m[0].length);`],
  ];

  it.each(fine)("%s", (_name, source) => {
    expectSame(source);
  });

  it("the call that crosses 400 is the one reported", () => {
    const source = `int d(int n) {\n  return 1 + d(n + 1);\n}\nSystem.out.println(d(0));`;
    const ran = runCompiled(compile(source));
    expect(ran.diagnostics[0]?.message).toBe(OVERFLOW);
    expect(ran.diagnostics[0]?.span.start.line).toBe(2);
  });
});
