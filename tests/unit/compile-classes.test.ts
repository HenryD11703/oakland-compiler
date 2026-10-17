import { describe, expect, it } from "vitest";
import { compile } from "../../src/core/compile/index";
import { expectSame, expectSameFailure } from "../helpers/differential";

describe("structs, classes and objects, compiled and interpreted (S-01 to S-06, S-17)", () => {
  const programs: [string, string][] = [
    ["a struct: literal, fields, assignment, printing", `struct Pet { string name; } struct Person { string name; int age; Pet pet; } Person ana = Person{name: "Ana", age: 20, pet: Pet{name: "Rex"}}; ana.age++; ana.pet.name = "Max"; ana.age += 5; System.out.println(ana.name, ana.age, ana.pet.name); System.out.println(ana); System.out.println("p=" + ana.pet);`],
    ["a struct is shared when it is passed", `struct P { int n; } void bump(P p) { p.n++; } P a = P{n: 1}; P b = a; bump(a); b.n += 10; System.out.println(a.n, b.n, a == b, a == P{n: 12});`],
    ["a struct with every kind of field", `struct S { int i; float f; boolean b; char c; string s; int[] a; } S s = S{i: 1, f: 2, b: true, c: 'x', s: "t", a: new int[2]}; System.out.println(s); s.f += 0.5; s.c = 'y'; s.a[0] = 9; System.out.println(s.f, s.c, s.a);`],
    ["a struct that leaves out a reference field", `struct N { int v; N next; string tag; } N n = N{v: 3}; System.out.println(n.next == null, n.tag, n);`],
    ["a struct inside an array and an array inside a struct", `struct P { int x; } P[] ps = {P{x: 1}, P{x: 2}}; ps[1].x = 20; System.out.println(ps, ps[0].x + ps[1].x); P[] q = new P[2]; System.out.println(q);`],
    ["a class with fields, a constructor and methods", `class Counter { int n; Counter(int start) { n = start; } void inc() { n++; } int get() { return n; } } Counter c = new Counter(5); c.inc(); c.inc(); System.out.println(c.get(), c.n);`],
    ["the fields of a new object are zero, false, '\\0' and null", `class D { int i; float f; boolean b; char c; string s; int[] a; D next; } D d = new D(); System.out.println(d.i, d.f, d.b, d.s, d.a, d.next, d.c == '\\0');`],
    ["initial values of fields, and a field that uses another", `class A { int x = 3; int y = x * 2; string name = "a" + y; int[] list = {1, 2}; } A a = new A(); System.out.println(a.x, a.y, a.name, a.list);`],
    ["constructors are told apart by their number of arguments", `class P { int a; int b; P() { a = 1; } P(int a) { this.a = a; } P(int a, int b) { this.a = a; this.b = b; } } System.out.println(new P().a, new P(7).a, new P(7, 8).b);`],
    ["a name inside a method is a variable, then a field", `class K { int n = 1; int test(int n) { return n; } int field() { return n; } int local() { int n = 50; return n; } int both() { int n = 5; return n + this.n; } } K k = new K(); System.out.println(k.test(9), k.field(), k.local(), k.both());`],
    ["inheritance: the parent's constructor, fields and methods", `class A { string name; A(string name) { this.name = name; } string hi() { return "hi " + name; } } class B extends A { int n; B(string name, int n) { super(name); this.n = n; } } B b = new B("x", 4); System.out.println(b.hi(), b.name, b.n);`],
    ["constructors run parent first, then initial values, then the body", `class A { int x = 1; A() { System.out.println("A body", x); } } class B extends A { int y = 2; B() { System.out.println("B body", x, y); } } class C extends B { int z = 3; C() { super(); System.out.println("C body", z); } } C c = new C();`],
    ["a class without a constructor under one with arguments in super", `class A { int v; A(int v) { this.v = v; } } class B extends A { B() { super(42); } } class C extends B { } System.out.println(new B().v, new C().v);`],
    ["virtual calls: the object decides", `class A { string sound() { return "..."; } void speak() { System.out.println(sound()); } } class D extends A { string sound() { return "woof"; } } class C extends A { string sound() { return "meow"; } void speak() { super.speak(); System.out.println("purr"); } } A[] zoo = {new D(), new C(), new A()}; for (A a : zoo) { a.speak(); } D d = new D(); d.speak();`],
    ["a method that is not overridden, called from a subclass variable", `class A { int f() { return 1; } int g() { return f() + 10; } } class B extends A { int f() { return 2; } } class C extends B { } C c = new C(); A a = c; System.out.println(a.g(), c.g(), a.f());`],
    ["a three-level hierarchy with an override in the middle", `class A { string who() { return "A"; } } class B extends A { string who() { return "B" + super.who(); } } class C extends B { string who() { return "C" + super.who(); } } A x = new C(); B y = new B(); System.out.println(x.who(), y.who(), new A().who());`],
    ["a new method in a subclass takes a slot after the parent's", `class A { int a() { return 1; } } class B extends A { int b() { return 2; } int a() { return 3; } } B b = new B(); A x = b; System.out.println(b.a(), b.b(), x.a());`],
    ["private fields and methods used inside the class", `class A { private int secret = 7; private int twice() { return secret * 2; } int open() { return twice() + secret; } } System.out.println(new A().open());`],
    ["methods take and return numbers, floats and objects", `class V { float x; float y; V(float x, float y) { this.x = x; this.y = y; } V plus(V o) { return new V(x + o.x, y + o.y); } float len2() { return x * x + y * y; } void scale(float k) { x = x * k; y = y * k; } } V a = new V(3, 4); V b = a.plus(new V(1, 1)); b.scale(2); System.out.println(a.len2(), b.x, b.y, b);`],
    ["an int argument widens to a float parameter and to a float field", `class A { float f; A(float f) { this.f = f; } void set(float g) { f = g; } float half(float v) { return v / 2; } } A a = new A(3); a.set(5); System.out.println(a.f, a.half(7), a);`],
    ["floats among ints keep every field in its place", `class M { int a; float b; int c; float d; boolean e; M() { a = 1; b = 2.5; c = 3; d = 4.5; e = true; } } M m = new M(); System.out.println(m.a, m.b, m.c, m.d, m.e, m);`],
    ["fields: ++, --, +=, -= and assignment as a value", `class A { int n; float f; string s = ""; } A a = new A(); a.n++; a.n += 4; a.n--; a.f += 1; a.f -= 0.25; a.s += "x"; a.s += 7; int y = (a.n = 10) + 1; int z; z = a.n = 3; System.out.println(a, y, z);`],
    ["a field written from a method, by name and by this", `class A { int n; void a() { n = 1; } void b() { this.n = this.n + 10; } void c() { n++; n += 100; } } A a = new A(); a.a(); a.b(); a.c(); System.out.println(a.n);`],
    ["objects link to objects", `class N { int v; N next; N(int v) { this.v = v; } } N a = new N(1); a.next = new N(2); a.next.next = new N(3); int t = 0; for (N p = a; p != null; p = p.next) { t += p.v; } System.out.println(t, a.next.next.v, a.next.next.next == null, a);`],
    ["a cycle prints with {...}", `class N { int v; N next; N(int v) { this.v = v; } } N a = new N(1); N b = new N(2); a.next = b; b.next = a; System.out.println(a); System.out.println(b); N s = new N(9); s.next = s; System.out.println("s=" + s);`],
    ["a struct cycle and an array that holds its owner", `struct T { int v; T[] kids; } T t = T{v: 1}; t.kids = new T[2]; t.kids[0] = t; System.out.println(t); class K { K[] all; } K k = new K(); k.all = new K[2]; k.all[1] = k; System.out.println(k); System.out.println(k.all);`],
    ["arrays of objects: new, literal, for each, print, indexOf", `class P { int x; P(int x) { this.x = x; } } P[] a = {new P(1), new P(2)}; P[] b = new P[2]; P p = a[1]; b[0] = p; System.out.println(a, b, a.indexOf(p), a.indexOf(null), b.indexOf(null), b.length); int t = 0; for (P q : a) { t += q.x; } System.out.println(t);`],
    ["a matrix of objects and a copy that shares the objects", `class P { int x; } P[][] m = new P[2][2]; m[0][0] = new P(); m[0][0].x = 4; P[][] c = m; c[0][0].x++; System.out.println(m[0][0].x, m);`],
    ["objects compare by identity, and against null", `class P { int x; } P a = new P(); P b = new P(); P c = a; P n = null; System.out.println(a == b, a == c, a != b, n == null, a != null, n == n);`],
    ["a subclass goes where its parent is expected", `class A { int v() { return 1; } } class B extends A { int v() { return 2; } } int get(A a) { return a.v(); } A a = new B(); A[] list = {new A(), new B()}; A pick = true ? new B() : new A(); System.out.println(get(a), get(new A()), list[1].v(), pick.v());`],
    ["a function returns an object; a method is called on the result", `class A { int n; A(int n) { this.n = n; } A next() { return new A(n + 1); } } A make(int n) { return new A(n); } System.out.println(make(3).next().next().n, make(1).n);`],
    ["a top-level variable seen by a method and by an initial value", `int base = 100; class A { int x = base + 1; int add(int d) { return base + d; } } A a = new A(); base = 200; System.out.println(a.x, a.add(5));`],
    ["a field wins over a global of the same name", `int n = 5; class A { int n = 7; int get() { return n; } } System.out.println(new A().get(), n);`],
    ["recursion in a method", `class F { int fib(int n) { if (n < 2) { return n; } return fib(n - 1) + fib(n - 2); } } System.out.println(new F().fib(15));`],
    ["a method that prints, and the order of the arguments", `class A { int a() { System.out.println("a"); return 1; } int b(int x) { System.out.println("b", x); return x; } } A o = new A(); o.b(o.a()); System.out.println(o.a(), o.b(2));`],
    ["a loop that builds a list inside a class", `class Stack { int[] items = new int[10]; int size; void push(int v) { items[size] = v; size++; } int pop() { size--; return items[size]; } boolean empty() { return size == 0; } } Stack s = new Stack(); for (int i = 0; i < 5; i++) { s.push(i * i); } string out = ""; while (!s.empty()) { out += s.pop() + " "; } System.out.println(out);`],
    ["an object in a string, with strings and chars inside", `class P { string name; char c; boolean ok; } P p = new P(); System.out.println("p: " + p); p.name = "Ana"; p.c = 'z'; p.ok = true; System.out.println("p: " + p);`],
    ["a ternary and a switch that use fields", `class A { int n; string s = "b"; } A a = new A(); a.n = 3; System.out.println(a.n > 2 ? "big" : "small"); switch (a.s) { case "a": System.out.println("A"); break; case "b": System.out.println("B"); break; default: System.out.println("?"); }`],
    ["the three class examples", `class Animal { string name; Animal(string name) { this.name = name; } string sound() { return "..."; } void speak() { System.out.println(name, "says", sound()); } } class Dog extends Animal { private int tricks; Dog(string name, int tricks) { super(name); this.tricks = tricks; } string sound() { return "Woof"; } int getTricks() { return tricks; } } Dog d = new Dog("Rex", 3); d.speak(); System.out.println(d, d.getTricks());`],
  ];

  it.each(programs)("%s", (_name, source) => {
    expectSame(source);
  });

  const failures: [string, string, string][] = [
    ["reading a field of null", `class A { int n; } A a = null; System.out.println(a.n);`, "cannot read field 'n' of null"],
    ["writing a field of null stops before the value is worked out", `class A { int n; } int f() { System.out.println("value"); return 1; } A a = null; a.n = f();`, "cannot use field 'n' of null"],
    ["calling a method on null, after the arguments", `class A { void m(int x) { } } int f() { System.out.println("arg"); return 1; } A a = null; a.m(f());`, "cannot call m on null"],
    ["a field of a field that is null", `class N { int v; N next; } N a = new N(); System.out.println(a.next.v);`, "cannot read field 'v' of null"],
    ["a struct field of null", `struct P { int x; } P p = null; p.x = 3;`, "cannot use field 'x' of null"],
    ["a method that divides by zero", `class A { int div(int d) { return 10 / d; } } System.out.println(new A().div(0));`, "division by zero"],
  ];

  it.each(failures)("%s", (_name, source, message) => {
    expectSameFailure(source, message);
  });

  it("a struct that leaves out a number is not compiled yet, and says where", () => {
    const result = compile(`struct P { string name; int age; } P p = P{name: "Luis"};`);
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.message).toContain("cannot be compiled yet");
  });

  it("shows the class table in the WebAssembly text", () => {
    const result = compile(`class A { int f() { return 1; } } class B extends A { int f() { return 2; } } A a = new B(); System.out.println(a.f());`);
    expect(result.wat).toContain("call_indirect");
    expect(result.wat).toContain("(table 2 funcref)");
  });
});
