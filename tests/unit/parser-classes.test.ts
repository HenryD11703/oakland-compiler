import { describe, expect, it } from "vitest";
import { tokenize } from "../../src/core/lexer/lexer";
import { parse } from "../../src/core/parser/parser";
import { expressionOf, parsesTo } from "../helpers/sexpr";

describe("class declarations", () => {
  it("parses fields, a constructor and methods", () => {
    expect(parsesTo("class Dog { string name; Dog(string n) { this.name = n; } string sound() { return \"Woof\"; } }")).toBe(
      '(class Dog (field string name) (ctor Dog (string n) (block (expr (= (. this name) n)))) (method string sound () (block (return "Woof"))))',
    );
  });

  it("parses extends, access modifiers and field initialisers", () => {
    expect(parsesTo("class Dog extends Animal { private int tricks = 3; public void roll() { } }")).toBe(
      "(class Dog extends Animal (private field int tricks 3) (method void roll () (block)))",
    );
  });

  it("parses an empty class and a class with array and class-typed fields", () => {
    expect(parsesTo("class Empty { }")).toBe("(class Empty)");
    expect(parsesTo("class Zoo { Animal[] animals; Animal best; }")).toBe("(class Zoo (field Animal[] animals) (field Animal best))");
  });

  it("parses super(...) as a statement and super.method(...) as a call", () => {
    expect(parsesTo("class B extends A { B(int x) { super(x, 1); } void f() { super.f(); } }")).toBe(
      "(class B extends A (ctor B (int x) (block (expr (super x 1)))) (method void f () (block (expr (call (. super f))))))",
    );
    expect(parsesTo("class B extends A { B() { super(); } }")).toBe("(class B extends A (ctor B () (block (expr (super)))))");
  });

  it("a class may be declared among other things, and the program goes on", () => {
    expect(parsesTo("int x = 1; class A { } A a = new A(); System.out.println(x);")).toBe(
      "(var int x 1) (class A) (var A a (new A)) (print x)",
    );
  });
});

describe("expressions with classes", () => {
  it("parses new with arguments, this and member access", () => {
    expect(expressionOf("new Dog(\"Rex\", 3)")).toBe('(new Dog "Rex" 3)');
    expect(expressionOf("new Dog()")).toBe("(new Dog)");
    expect(expressionOf("this")).toBe("this");
    expect(expressionOf("this.name")).toBe("(. this name)");
    expect(expressionOf("a.b.c(1)")).toBe("(call (. (. a b) c) 1)");
    expect(expressionOf("new Dog(1).name")).toBe("(. (new Dog 1) name)");
  });

  it("still parses arrays of classes and of primitives", () => {
    expect(expressionOf("new Dog[3]")).toBe("(new Dog 3)");
    expect(expressionOf("new int[2][3]")).toBe("(new int 2 3)");
  });

  it("allows ++ and assignment on a field of this", () => {
    expect(parsesTo("class C { int n; void f() { this.n++; this.n = 5; n += 2; } }")).toBe(
      "(class C (field int n) (method void f () (block (++ (. this n)) (expr (= (. this n) 5)) (expr (+= n 2)))))",
    );
  });
});

describe("words that start like the new keywords are still names", () => {
  it("reads classic, newest, thisValue, superb, privateKey, publicity and extended as names", () => {
    for (const name of ["classic", "newest", "thisValue", "superb", "privateKey", "publicity", "extended"]) {
      expect(parsesTo(`int ${name} = 1;`)).toBe(`(var int ${name} 1)`);
      expect(tokenize(name).tokens[0]?.type).toBe("identifier");
    }
  });

  it("rejects the reserved words on their own", () => {
    for (const word of ["class", "extends", "this", "super", "private", "public"]) {
      expect(parse(`int ${word} = 1;`).diagnostics.length, word).toBeGreaterThan(0);
    }
  });
});

describe("syntax mistakes with classes are reported with a place and a reason", () => {
  const cases: [string, string, number][] = [
    ["a class inside a block", "{ class A { } }", 1],
    ["a class inside a function", "void f() { class A { } }", 1],
    ["no name", "class { }", 1],
    ["no name after extends", "class A extends { }", 1],
    ["no body", "class A int x;", 1],
    ["unclosed class", "class A { int x;", 1],
    ["a constructor with the wrong name", "class A { B() { } }", 1],
    ["a method without a return type", "class A { f() { } }", 1],
    ["a void field", "class A { void x; }", 1],
    ["a var field", "class A { var x = 1; }", 1],
    ["a statement in the class body", "class A { x = 1; }", 1],
    ["a field without a semicolon", "class A { int x }", 1],
    ["new without parentheses or brackets", "A a = new A;", 1],
    ["super alone", "class B extends A { B() { super; } }", 1],
    ["a declaration as an if body", "if (true) class A { }", 1],
  ];
  for (const [name, source, line] of cases) {
    it(name, () => {
      const result = parse(source);
      expect(result.diagnostics.length, source).toBeGreaterThan(0);
      expect(result.diagnostics[0]?.phase).toBe("syntax");
      expect(result.diagnostics[0]?.span.start.line).toBe(line);
      expect(result.diagnostics[0]?.message.length).toBeGreaterThan(10);
    });
  }

  it("says what to do about a misnamed constructor", () => {
    const message = parse("class Dog { Cat() { } }").diagnostics[0]?.message ?? "";
    expect(message).toContain("'Cat(...)'");
    expect(message).toContain("'Dog'");
  });

  it("recovers: a broken member does not hide the next class", () => {
    const result = parse("class A { int x }\nclass B { int y; }");
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
    const names = result.program.body.filter((s) => s.kind === "ClassDecl").map((s) => (s as { name: string }).name);
    expect(names).toContain("B");
  });

  it("never reports more than ten errors and always finishes", () => {
    const source = "class A {\n" + "  int ;\n".repeat(40) + "}";
    const result = parse(source);
    expect(result.diagnostics.length).toBeLessThanOrEqual(10);
  });
});
