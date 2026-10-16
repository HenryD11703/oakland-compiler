import { describe, expect, it } from "vitest";
import { out, problems, runOak } from "../helpers/run";

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

describe("objects, fields, constructors and methods (S-01 to S-03)", () => {
  it("creates an object, runs its constructor and calls its methods", () => {
    expect(
      out(`
      class Counter {
          int n;
          Counter(int start) { this.n = start; }
          void inc() { n++; }
          int get() { return n; }
      }
      Counter c = new Counter(5);
      c.inc(); c.inc();
      System.out.println(c.get(), c.n);
    `),
    ).toBe("7 7");
  });

  it("gives a class without a constructor an empty one", () => {
    expect(out("class P { int x; } P p = new P(); System.out.println(p.x);")).toBe("0");
  });

  it("starts fields at the Java default: 0, 0.0, false, the zero character and null", () => {
    const text = out(`
      class D { int i; float f; boolean b; char c; string s; D self; int[] a; }
      D d = new D();
      System.out.println(d.i, d.f, d.b, d.c == '\\0', d.s, d.self, d.a);
    `);
    expect(text).toBe("0 0.0 false true null null null");
  });

  it("evaluates field initialisers before the body of the constructor, parents first", () => {
    expect(
      out(`
      class A { int x = 1; A() { System.out.println("A", x); x = 10; } }
      class B extends A { int y = x + 1; B() { System.out.println("B", x, y); } }
      B b = new B();
      System.out.println(b.x, b.y);
    `),
    ).toBe("A 1\nB 10 11\n10 11");
  });

  it("a parameter hides a field and this.name reaches the field", () => {
    expect(
      out(`
      class P { string name; P(string name) { this.name = name + "!"; } string show(string name) { return name + "/" + this.name; } }
      System.out.println(new P("a").show("b"));
    `),
    ).toBe("b/a!");
  });

  it("a field is found before a global variable of the same name", () => {
    expect(out("int n = 100; class C { int n = 1; int get() { return n; } } System.out.println(new C().get(), n);")).toBe("1 100");
  });

  it("changes made through one name are seen through another (objects are shared)", () => {
    expect(out("class C { int n; } C a = new C(); C b = a; b.n = 5; a.n++; System.out.println(a.n, b.n, a == b);")).toBe("6 6 true");
  });

  it("two objects of one class are different", () => {
    expect(out("class C { int n; } C a = new C(); C b = new C(); System.out.println(a == b, a.n == b.n);")).toBe("false true");
  });

  it("supports recursion, methods that call methods, and methods that return objects", () => {
    expect(
      out(`
      class M {
          int fib(int n) { if (n < 2) { return n; } return fib(n - 1) + fib(n - 2); }
          int twice(int n) { return fib(n) * 2; }
          M self() { return this; }
      }
      M m = new M();
      System.out.println(m.twice(10), m.self().fib(6), m.self() == m);
    `),
    ).toBe("110 8 true");
  });

  it("builds a linked list with objects that point to objects", () => {
    expect(
      out(`
      class Node { int value; Node next; Node(int v, Node n) { value = v; next = n; } }
      class Stack {
          Node top; int size;
          void push(int v) { top = new Node(v, top); size++; }
          int pop() { int v = top.value; top = top.next; size--; return v; }
      }
      Stack s = new Stack();
      s.push(1); s.push(2); s.push(3);
      System.out.println(s.pop(), s.pop(), s.size, s.top.value);
    `),
    ).toBe("3 2 1 1");
  });

  it("works with arrays of objects, which start as null", () => {
    expect(
      out(`
      class C { int n; C(int n) { this.n = n; } }
      C[] list = new C[3];
      System.out.println(list[0] == null, list.length);
      list[1] = new C(7);
      System.out.println(list[1].n, list[2]);
    `),
    ).toBe("true 3\n7 null");
  });

  it("shows an object like a struct when it is printed, and typeof gives the declared type", () => {
    expect(out(`${ANIMALS} Animal a = new Dog("Rex", 3); System.out.println(a); System.out.println(typeof a);`)).toBe("Dog{name: Rex, tricks: 3}\nAnimal");
  });

  it("classes and structs can be used together", () => {
    expect(out("struct P { int x; } class Box { P p; Box() { p = P{x: 4}; } } Box b = new Box(); b.p.x++; System.out.println(b.p.x);")).toBe("5");
  });

  it("a class can be used before the line that declares it", () => {
    expect(out("System.out.println(new Later().hi()); class Later { string hi() { return \"hello\"; } }")).toBe("hello");
  });
});

describe("inheritance and virtual calls (S-04 to S-06)", () => {
  it("runs the method of the real class through a variable of the parent type", () => {
    expect(out(`${ANIMALS} Animal a = new Dog("Rex", 3); a.speak(); Animal c = new Cat("Tom"); c.speak();`)).toBe("Rex says Woof\nTom says Meow\n(purrs)");
  });

  it("uses inherited fields and methods", () => {
    expect(out(`${ANIMALS} Dog d = new Dog("Fido", 7); System.out.println(d.name, d.getTricks()); d.speak();`)).toBe("Fido 7\nFido says Woof");
  });

  it("super.method() runs the parent's version", () => {
    expect(out(`${ANIMALS} new Cat("Tom").speak();`)).toBe("Tom says Meow\n(purrs)");
  });

  it("a parent method that calls an overridden method reaches the override", () => {
    expect(
      out(`
      class Shape { string name() { return "shape"; } string describe() { return "I am a " + name(); } }
      class Square extends Shape { string name() { return "square"; } }
      System.out.println(new Shape().describe()); System.out.println(new Square().describe());
    `),
    ).toBe("I am a shape\nI am a square");
  });

  it("builds a three-level chain, parents first, with and without super arguments", () => {
    expect(
      out(`
      class A { A() { System.out.println("A"); } }
      class B extends A { B() { System.out.println("B"); } }
      class C extends B { C(int n) { super(); System.out.println("C", n); } }
      C c = new C(3);
    `),
    ).toBe("A\nB\nC 3");
  });

  it("passes arguments up with super(...)", () => {
    expect(out("class A { int x; A(int x) { this.x = x; } } class B extends A { B() { super(42); } } System.out.println(new B().x);")).toBe("42");
  });

  it("a Dog goes wherever an Animal is expected: variables, parameters, returns and arrays", () => {
    expect(
      out(`${ANIMALS}
      Animal pick(Animal a) { return a; }
      Animal made() { return new Cat("Kit"); }
      Animal x = new Dog("A", 1);
      Animal[] zoo = {new Dog("B", 2), new Cat("C"), new Animal("D")};
      pick(new Dog("E", 3)).speak(); made().speak(); x.speak();
      for (Animal z : zoo) { z.speak(); }
    `),
    ).toBe("E says Woof\nKit says Meow\n(purrs)\nA says Woof\nB says Woof\nC says Meow\n(purrs)\nD says ...");
  });

  it("compares a parent-typed variable with a child-typed one by identity", () => {
    expect(out(`${ANIMALS} Dog d = new Dog("A", 1); Animal a = d; System.out.println(a == d, d == new Dog("A", 1));`)).toBe("true false");
  });
});

describe("private members (S-07)", () => {
  it("lets a class use its own private members, also on another object of the same class", () => {
    expect(
      out(`
      class Account {
          private int balance;
          private void log(string s) { System.out.println(s, balance); }
          Account(int b) { balance = b; }
          void add(int n) { balance += n; log("added"); }
          boolean richer(Account other) { return balance > other.balance; }
      }
      Account a = new Account(5); Account b = new Account(3); a.add(1);
      System.out.println(a.richer(b));
    `),
    ).toBe("added 6\ntrue");
  });

  it("reports use of a private field or method from outside", () => {
    expect(problems("class A { private int x; private void f() { } } A a = new A(); a.x = 1;")).toEqual(["'x' is private in 'A'"]);
    expect(problems("class A { private int x; } A a = new A(); System.out.println(a.x);")).toEqual(["'x' is private in 'A'"]);
    expect(problems("class A { private void f() { } } A a = new A(); a.f();")).toEqual(["'f' is private in 'A'"]);
  });

  it("a subclass cannot use a private field or method of its parent, by name or through this", () => {
    const parent = "class A { private int x; private int f() { return 1; } }";
    expect(problems(`${parent} class B extends A { int g() { return x; } } System.out.println(new B().g());`)).toContain("'x' is private in 'A'");
    expect(problems(`${parent} class B extends A { int g() { return this.x; } } System.out.println(new B().g());`)).toContain("'x' is private in 'A'");
    expect(problems(`${parent} class B extends A { int g() { return f(); } } System.out.println(new B().g());`)).toContain("'f' is private in 'A'");
  });

  it("a private constructor can be used only inside its class", () => {
    expect(problems("class A { private A() { } } A a = new A();")).toEqual(["the constructor of 'A' is private"]);
  });
});

describe("null and other runtime problems (S-08)", () => {
  it("reports a field or a method of null with the position and keeps going", () => {
    const result = runOak(`class A { int x; int f() { return 1; } }\nA a = null;\nSystem.out.println(a.x);\nSystem.out.println(a.f());\nSystem.out.println("after");`);
    expect(result.diagnostics.map((d) => `${d.phase} ${d.span.start.line} ${d.message}`)).toEqual([
      "runtime 3 cannot read field 'x' of null",
      "runtime 4 cannot call f on null",
    ]);
    expect(result.stdout).toContain("after");
  });

  it("reports writing a field of null", () => {
    expect(problems("class A { int x; } A a = null; a.x = 1;")).toEqual(["cannot use field 'x' of null"]);
  });

  it("an object with a null field can still be used", () => {
    expect(out("class A { A next; int x; } A a = new A(); System.out.println(a.next == null, a.next);")).toBe("true null");
  });

  it("ends a run that recurses without end with a stack overflow, not an exception", () => {
    const result = runOak("class A { void f() { f(); } } new A().f();");
    expect(result.diagnostics[0]?.message).toContain("stack overflow");
    expect(result.stoppedEarly).toBe(true);
  });

  it("ends a constructor loop (a class that builds itself) with a stack overflow", () => {
    const result = runOak("class A { A() { new A(); } } new A();");
    expect(result.diagnostics[0]?.message).toContain("stack overflow");
  });
});

describe("every class mistake is a diagnostic with a place (S-09)", () => {
  const cases: [string, string, string][] = [
    ["unknown class in new", "var f = new Foo();", "unknown class 'Foo'"],
    ["unknown class as a variable type", "Foo f = null;", "unknown type 'Foo'"],
    ["unknown parent class", "class A extends Nope { }", "unknown class 'Nope'"],
    ["a struct as parent", "struct S { int x; } class A extends S { }", "'S' is a struct; a class can only extend a class"],
    ["new on a struct", "struct S { int x; } S s = new S();", "'S' is a struct: create it with S{...}, not with new"],
    ["a class extends itself", "class A extends A { }", "a class cannot extend itself ('A')"],
    ["a cycle of classes", "class A extends B { } class B extends A { }", "which extends it back"],
    ["a duplicate class", "class A { } class A { }", "'A' is already declared in this scope"],
    ["a duplicate field", "class A { int x; string x; }", "class 'A' already has a field named 'x'"],
    ["a field declared again in a subclass", "class A { int x; } class B extends A { int x; }", "'x' is already a field of 'A'; a subclass cannot declare it again"],
    ["an unknown field type", "class A { Nope n; }", "unknown type 'Nope'"],
    ["a duplicate method", "class A { void f() { } int f() { return 1; } }", "class 'A' already has a method named 'f'"],
    ["a duplicate constructor", "class A { A(int a) { } A(int b) { } }", "class 'A' already has a constructor with 1 parameter"],
    ["an override with other parameters", "class A { void f(int a) { } } class B extends A { void f(string a) { } }", "so it must have the same parameters and return type: void(int)"],
    ["an override with another return type", "class A { int f() { return 1; } } class B extends A { string f() { return \"\"; } }", "so it must have the same parameters and return type: int()"],
    ["an override of a private method", "class A { private void f() { } } class B extends A { void f() { } }", "'f' is private in 'A' and cannot be overridden"],
    ["a private override of a public method", "class A { void f() { } } class B extends A { private void f() { } }", "an overriding method cannot be private"],
    ["a missing super call", "class A { A(int x) { } } class B extends A { B() { } }", "'B' must start its constructor with super(...): 'A' has no constructor without arguments"],
    ["a class without constructor whose parent needs arguments", "class A { A(int x) { } } class B extends A { }", "'B' must start its constructor with super(...)"],
    ["super with the wrong number of arguments", "class A { A(int x) { } } class B extends A { B() { super(1, 2); } }", "'A' has no constructor with 2 arguments; it has 1"],
    ["super without a parent", "class A { A() { super(); } }", "'A' has no parent class, so super(...) cannot be used"],
    ["super(...) that is not the first statement", "class A { } class B extends A { B() { int x = 1; super(); } }", "super(...) can only be the first statement of a constructor"],
    ["super(...) inside a block of a constructor", "class A { } class B extends A { B() { { super(); } } }", "super(...) can only be the first statement of a constructor"],
    ["super(...) in a method", "class A { } class B extends A { void f() { super(); } }", "super(...) can only be the first statement of a constructor"],
    ["super(...) at the top level", "super();", "super(...) can only be the first statement of a constructor"],
    ["super(...) used as a value", "class A { } class B extends A { B() { int x = super(); } } new B();", "super(...) can only be the first statement of a constructor"],
    ["super.method without a parent", "class A { void f() { super.f(); } } new A().f();", "'A' has no parent class, so 'super' cannot be used"],
    ["super.method that does not exist", "class A { } class B extends A { void f() { super.g(); } } new B().f();", "'A' has no method 'g'"],
    ["this outside a class", "System.out.println(this);", "'this' can only be used inside a method or a constructor of a class"],
    ["this in a function", "void f() { System.out.println(this); } f();", "'this' can only be used inside a method or a constructor of a class"],
    ["a bare super", "class A { void f() { int x = super; } }", "expected '(' or '.' after 'super'"],
    ["wrong number of constructor arguments", "class A { A(int a) { } } A a = new A();", "no constructor of 'A' takes 0 arguments; it takes 1"],
    ["arguments for a class with no constructor", "class A { } A a = new A(1);", "'A' has no constructor with arguments, but 1 was given"],
    ["wrong type of constructor argument", "class A { A(int a) { } } A a = new A(\"x\");", "argument 1 of 'A' must be int, but it is string"],
    ["wrong number of method arguments", "class A { void f(int a) { } } new A().f();", "'f' expects 1 argument but got 0"],
    ["wrong type of method argument", "class A { void f(int a) { } } new A().f(true);", "argument 1 of 'f' must be int, but it is boolean"],
    ["an unknown field", "class A { } A a = new A(); a.z = 1;", "class 'A' has no field 'z'"],
    ["an unknown field read", "class A { } A a = new A(); System.out.println(a.z);", "class 'A' has no field 'z'"],
    ["an unknown method", "class A { } new A().go();", "class 'A' has no method 'go'"],
    ["a field called as a method", "class A { int x; } new A().x();", "'x' is a field of 'A', not a method"],
    ["a method read as a field", "class A { void f() { } } A a = new A(); System.out.println(a.f);", "'f' is a method of 'A'; call it as f(...)"],
    ["a field of a subclass through the parent type", "class A { } class B extends A { int y; } A a = new B(); System.out.println(a.y);", "class 'A' has no field 'y'"],
    ["a method of a subclass through the parent type", "class A { } class B extends A { void g() { } } A a = new B(); a.g();", "class 'A' has no method 'g'"],
    ["a parent where a child is expected", "class A { } class B extends A { } A a = new A(); B b = a;", "cannot assign A to B"],
    ["an unrelated class", "class A { } class B { } A a = new B();", "cannot assign B to A"],
    ["a wrong return type in a method", "class A { int f() { return \"x\"; } } new A().f();", "'f' must return int, but it returned string"],
    ["a method that does not return", "class A { int f() { } } new A().f();", "'f' must return a value of type int"],
    ["a value returned from a constructor", "class A { A() { return 1; } } new A();", "a constructor cannot return a value"],
    ["a wrong type for a field initialiser", "class A { int x = \"s\"; } new A();", "cannot assign string to the field 'x' of type int"],
    ["a class name used as a value", "class A { } int x = A;", "'A' is a class"],
    ["a class called as a function", "class A { } A();", "'A' is a class, not a function"],
    ["break outside a loop inside a method", "class A { void f() { break; } }", "'break' is only allowed inside a loop or a switch"],
  ];
  for (const [name, source, expected] of cases) {
    it(name, () => {
      const messages = problems(source);
      expect(messages.some((m) => m.includes(expected)), `${source}\n  expected "${expected}"\n  got ${JSON.stringify(messages)}`).toBe(true);
    });
  }

  it("each of those mistakes is reported once, with the right position", () => {
    const result = runOak("class A {\n  int x;\n  int x;\n}");
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.span.start.line).toBe(3);
  });
});

describe("symbols of classes", () => {
  it("lists the class, its fields, its methods and the constructor, and the parameters of a method", () => {
    const result = runOak("class A { int x; A(int v) { x = v; } int get(int d) { return x + d; } }\nA a = new A(1);\nSystem.out.println(a.get(2));");
    const names = result.symbols.map((s) => `${s.kind} ${s.name} ${s.type} [${s.scope}]`);
    expect(names).toContain("class A A [global]");
    expect(names).toContain("field x int [class A]");
    expect(names).toContain("method A A(int) [class A]");
    expect(names).toContain("method get int(int) [class A]");
    expect(names).toContain("variable v int [method A.new]");
    expect(names).toContain("variable d int [method A.get]");
  });
});
