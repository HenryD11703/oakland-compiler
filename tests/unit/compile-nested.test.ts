import { describe, expect, it } from "vitest";
import { compile } from "../../src/core/compile/index";
import { expectSame, expectSameFailure } from "../helpers/differential";

describe("functions declared inside other functions, compiled and interpreted (S-17)", () => {
  const programs: [string, string][] = [
    ["an inner function sees the parameters and variables around it", `int total(int a, int b) { int bonus = 10; int inner() { return a + b + bonus; } return inner(); } System.out.println(total(10, 20));`],
    ["an inner function changes a variable around it", `void go() { int n = 1; void inc() { n++; } inc(); inc(); System.out.println(n); } go();`],
    ["a function can be called before the line that declares it", `void go() { System.out.println(f()); int f() { return 7; } } go();`],
    ["an inner variable hides the one around it, and a parameter too", `void go() { int x = 1; int f() { int x = 2; return x; } System.out.println(f(), x); } go(); int h(int x) { int f(int x) { return x * 2; } return f(x + 1); } System.out.println(h(4));`],
    ["an inner function that calls itself", `void go() { int fact(int n) { if (n == 0) { return 1; } return n * fact(n - 1); } System.out.println(fact(5)); } go();`],
    ["an inner function calls one declared later, which uses a variable declared in between", `void go() { int a() { return b(); } int k = 3; int b() { return k * 2; } System.out.println(a()); } go();`],
    ["a function inside a function inside a function", `void go() { int x = 1; void a() { int y = 2; void b() { x += y; } b(); b(); } a(); System.out.println(x); } go();`],
    ["three levels, each using a variable of another level", `int go(int p) { int q = 10; int mid(int r) { int s = 100; int low() { return p + q + r + s; } return low() + 1000; } return mid(1); } System.out.println(go(2));`],
    ["a function declared in a loop sees the variable of the loop", `void go() { for (int i = 0; i < 3; i++) { int sq() { return i * i; } System.out.println(sq()); } } go();`],
    ["a function in a loop changes a variable outside it", `void go() { int s = 0; for (int i = 1; i <= 3; i++) { int add() { s += i; return s; } add(); } System.out.println(s); } go();`],
    ["the same name in two blocks", `void go() { { int f() { return 1; } System.out.println(f()); } { int f() { return 2; } System.out.println(f()); } } go();`],
    ["an inner function in the main program, around variables of its block", `int base = 100; { int local = 5; int f(int d) { return base + local + d; } System.out.println(f(1)); }`],
    ["an inner function around a variable of the main program", `int count = 0; void bump() { } void tick() { count++; } { void inc() { count += 10; } inc(); inc(); } System.out.println(count);`],
    ["a function inside a top-level function that uses a top-level variable", `int local = 5; int f() { int g() { return local; } return g(); } System.out.println(f());`],
    ["arrays, strings and floats through a frame", `void go() { int[] a = {1, 2}; string s = "x"; float f = 1.5; void work() { a[0] = 9; s += "y"; f = f * 2; } work(); System.out.println(a, s, f); } go();`],
    ["an inner function that returns an array or a string", `void go() { int[] a = {1, 2}; int[] dbl() { int[] r = new int[a.length]; for (int i = 0; i < a.length; i++) { r[i] = a[i] * 2; } return r; } string tag() { return "n=" + a.length; } System.out.println(dbl(), tag()); } go();`],
    ["the arguments are widened to the parameter types", `void go() { float half(float x) { return x / 2; } System.out.println(half(5), half(2.5)); } go();`],
    ["a function in a method sees the fields, the parameters and this", `class A { int v = 4; int m(int k) { int h() { return v + k; } return h(); } } System.out.println(new A().m(2));`],
    ["a function in a method changes a field", `class A { int v = 4; void m() { void h() { v = v + 1; } h(); h(); } } A a = new A(); a.m(); System.out.println(a.v);`],
    ["a function in a method calls a method of the class", `class A { int base() { return 100; } int m() { int h(int d) { return base() + d; } return h(5); } } System.out.println(new A().m());`],
    ["a function in a constructor", `class A { int v; A(int a) { int twice() { return a * 2; } v = twice(); } } System.out.println(new A(21).v);`],
    ["a function in an overridden method", `class A { int f() { return 1; } } class B extends A { int f() { int g() { return 5; } return g() + super.f(); } } A a = new B(); System.out.println(a.f());`],
    ["an inner function called many times keeps the depth right", `int go() { int n = 0; void add() { n++; } for (int i = 0; i < 2000; i++) { add(); } return n; } System.out.println(go());`],
    ["each call of the outer function has its own frame", `int go(int n) { int x = n; int get() { return x; } if (n > 0) { return get() + go(n - 1); } return get(); } System.out.println(go(5));`],
    ["a variable of the loop declared again each time, and a function that reads it", `void go() { for (int i = 0; i < 3; i++) { int v = i * 10; int read() { return v; } System.out.println(read()); } } go();`],
    ["a for each variable used by an inner function", `void go() { int[] a = {3, 4}; for (int x : a) { int sq() { return x * x; } System.out.println(sq()); } } go();`],
    ["a switch that calls an inner function", `void go() { int one() { return 1; } int n = 2; switch (n) { case 1: System.out.println("one"); break; case 2: System.out.println(one() + 1); break; } } go();`],
    ["an inner function with no variable of the outer one", `void go() { int sq(int x) { return x * x; } System.out.println(sq(7)); } go();`],
    ["a function inside a function that has no variables to share, with another level below", `void go() { void a() { int y = 2; void b() { System.out.println(y); } b(); } a(); } go();`],
  ];

  it.each(programs)("%s", (_name, source) => {
    expectSame(source);
  });

  it("deep recursion of an inner function stops at 400 calls, like the interpreter", () => {
    expectSameFailure(`void go() { int d(int n) { if (n == 0) { return 0; } return 1 + d(n - 1); } System.out.println(d(500)); } go();`, "stack overflow: more than 400 calls nested inside each other");
  });

  it("an error inside an inner function has the interpreter's words and place", () => {
    expectSameFailure(`void go() { int[] a = {1}; int pick(int i) { return a[i]; } System.out.println(pick(3)); } go();`, "index 3 is out of range for an array of length 1");
  });

  it("nothing of this kind is left unsupported", () => {
    const result = compile(`void go() { int f() { return 1; } System.out.println(f()); } go();`);
    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
  });
});
