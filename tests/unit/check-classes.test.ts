import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "../../src/core/parser/parser";
import { CLASS_MISTAKES } from "../helpers/class-mistakes";
import { mistakes, mistakesAt, typeOf } from "../helpers/check";

const ANIMALS = `
class Animal {
    string name;
    Animal(string name) { this.name = name; }
    string sound() { return "..."; }
    void speak() { System.out.println(name, "says", sound()); }
}
class Dog extends Animal {
    private int tricks;
    Dog(string name, int tricks) { super(name); this.tricks = tricks; }
    string sound() { return "Woof"; }
    int getTricks() { return tricks; }
}
class Cat extends Animal {
    Cat(string name) { super(name); }
    string sound() { return "Meow"; }
    void speak() { super.speak(); System.out.println("(purrs)"); }
}
`;

describe("the checker finds every class mistake (S-09, S-12)", () => {
  it.each(CLASS_MISTAKES.map((c) => [...c]))("%s", (_name, source, expected) => {
    // A mistake of syntax is the parser's; the checker is for the programs that parse.
    const syntax = parse(source as string).diagnostics.map((d) => d.message);
    const found = syntax.length > 0 ? syntax : mistakes(source as string);
    expect(found.some((m) => m.includes(expected as string)), `${source}\n  expected "${expected}"\n  got ${JSON.stringify(found)}`).toBe(true);
  });

  it("finds a mistake in a method that nothing calls and in a class nothing uses", () => {
    expect(mistakes("class A { int f() { return \"s\"; } }")).toEqual(["'f' must return int, but it returned string"]);
    expect(mistakes("class A { void f() { int x = undeclared; } }")).toEqual(["variable 'undeclared' is not declared"]);
  });

  it("reports a class mistake once, at the right place", () => {
    expect(mistakesAt("class A {\n  int x;\n  int x;\n}")).toEqual(["3:7 class 'A' already has a field named 'x'"]);
    expect(mistakesAt("class P { }\nclass D extends P {\n  void f() { g(); }\n}")).toEqual(["3:14 function 'g' is not declared"]);
  });
});

describe("what the checker accepts in classes", () => {
  it("accepts the animals", () => {
    expect(mistakes(`${ANIMALS} Animal a = new Dog("Rex", 3); a.speak(); Animal[] zoo = {new Dog("A", 1), new Cat("B"), new Animal("C")};`)).toEqual([]);
  });

  it("accepts the three class examples", () => {
    for (const file of ["animals.oak", "bank-account.oak", "linked-list.oak"]) {
      expect(mistakes(readFileSync(join(import.meta.dirname, "..", "..", "src", "examples", file), "utf8")), file).toEqual([]);
    }
  });

  it("types the members of a class", () => {
    const prelude = `${ANIMALS} Animal an = new Dog("d", 1); Dog dg = new Dog("e", 2); Cat ct = new Cat("c");`;
    expect(typeOf("an.name", prelude)).toBe("string");
    expect(typeOf("an.sound()", prelude)).toBe("string");
    expect(typeOf("dg.getTricks()", prelude)).toBe("int");
    expect(typeOf("dg.name", prelude)).toBe("string");
    expect(typeOf('new Cat("x")', prelude)).toBe("Cat");
    expect(typeOf("an == ct", prelude)).toBe("boolean");
    expect(typeOf("an = ct", prelude)).toBe("Animal");
    expect(typeOf("an.speak()", `${prelude}`.replace("void speak", "void speak"))).toBe("void");
  });

  it("this has the type of the class that wrote the method", () => {
    expect(mistakes("class A { A me() { return this; } int n; int get() { return this.n; } }")).toEqual([]);
    expect(mistakes("class A { } class B extends A { A up() { return this; } }")).toEqual([]);
    expect(mistakes("class A { } class B extends A { B down(A a) { return a; } }")).toEqual(["'down' must return B, but it returned A"]);
  });

  it("a field is found before a global of the same name, a parameter before a field", () => {
    expect(mistakes("int n = 1; class C { string n = \"s\"; string get() { return n; } string with(int n) { return \"\" + n; } }")).toEqual([]);
    expect(mistakes("int n = 1; class C { string n = \"s\"; int get() { return n; } }")).toEqual(["'get' must return int, but it returned string"]);
  });

  it("field initial values are checked, and see the fields before them", () => {
    expect(mistakes("class C { int a = 1; int b = a + 1; }")).toEqual([]);
    expect(mistakes("class C { int[] xs = {1, 2}; string s = null; C next = null; }")).toEqual([]);
  });

  it("super(...) arguments are checked against the parent's constructor", () => {
    expect(mistakes("class A { A(int x) { } } class B extends A { B() { super(\"s\"); } }")).toEqual(["argument 1 of 'A' must be int, but it is string"]);
    expect(mistakes("class A { A(int x) { } A() { } } class B extends A { B() { super(1); } B(int y) { } }")).toEqual([]);
  });

  it("a method call is checked against the method of the declared type", () => {
    expect(mistakes("class A { int f(int a) { return a; } } A a = new A(); int x = a.f(1); int y = a.f(\"s\");")).toEqual(["argument 1 of 'f' must be int, but it is string"]);
  });

  it("a call to a method that returns nothing cannot be used as a value", () => {
    expect(mistakes("class A { void f() { } } A a = new A(); int x = a.f();")).toEqual(["this call returns no value"]);
  });

  it("private is a matter of where the code is written", () => {
    expect(mistakes("class A { private int x; boolean same(A o) { return o.x == x; } }")).toEqual([]);
    expect(mistakes("class A { private int x; } class B extends A { int f() { return x; } }")).toEqual(["'x' is private in 'A'"]);
  });
});
