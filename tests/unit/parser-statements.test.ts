import { describe, expect, it } from "vitest";
import { parsesTo } from "../helpers/sexpr";

const table = (cases: ReadonlyArray<readonly [string, string]>): void => {
  it.each(cases)("%s", (source, expected) => {
    expect(parsesTo(source)).toBe(expected);
  });
};

const PERSON = "struct Person { string name; int age; }\n";

describe("variable declarations", () => {
  table([
    ["int x;", "(var int x)"],
    ["int x = 1;", "(var int x 1)"],
    ["float f = 2.5;", "(var float f 2.5)"],
    ['string s = "a";', '(var string s "a")'],
    ["boolean b = true;", "(var boolean b true)"],
    ["char c = 'x';", "(var char c 'x')"],
    ["var v = 3;", "(var var v 3)"],
    ["int integer = 1;", "(var int integer 1)"],
    ["boolean trueValue = true;", "(var boolean trueValue true)"],
    ["int nullable = 3;", "(var int nullable 3)"],
  ]);
});

describe("arrays and matrices", () => {
  table([
    ["int[] a = {1, 2, 3};", "(var int[] a {1 2 3})"],
    ["int[] a = new int[5];", "(var int[] a (new int 5))"],
    ["int[] b = a;", "(var int[] b a)"],
    ["int[] e = {};", "(var int[] e {})"],
    ["int [ ] spaced = {1};", "(var int[] spaced {1})"],
    ["int[][] m = new int[2][3];", "(var int[][] m (new int 2 3))"],
    ["int[][] m = {{1, 2}, {3, 4}};", "(var int[][] m {{1 2} {3 4}})"],
    ["int[][][] c = {{{1}, {2}}, {{3}, {4}}};", "(var int[][][] c {{{1} {2}} {{3} {4}}})"],
    ["string[] names = {\"a\", \"b\"};", '(var string[] names {"a" "b"})'],
  ]);
});

describe("structs (AC-18)", () => {
  table([
    ["struct P { string name; int age; }", "(struct P (string name) (int age))"],
    ["struct P { string name; int age; };", "(struct P (string name) (int age))"],
    ["struct Empty { }", "(struct Empty)"],
    ["struct P { int x; }\nstruct Q { P p; int[] xs; }", "(struct P (int x)) (struct Q (P p) (int[] xs))"],
    [`${PERSON}Person p;`, "(struct Person (string name) (int age)) (var Person p)"],
    [
      `${PERSON}Person p = Person{name: "Ana", age: 20};`,
      '(struct Person (string name) (int age)) (var Person p (struct Person name:"Ana" age:20))',
    ],
    [`${PERSON}Person p = Person{};`, "(struct Person (string name) (int age)) (var Person p (struct Person))"],
    [`${PERSON}Person[] ps = new Person[2];`, "(struct Person (string name) (int age)) (var Person[] ps (new Person 2))"],
    [
      `${PERSON}struct Pet { string name; }\nPerson p = Person{name: "a", age: 1};\np.age = 21; p.age++;`,
      '(struct Person (string name) (int age)) (struct Pet (string name)) (var Person p (struct Person name:"a" age:1)) (expr (= (. p age) 21)) (++ (. p age))',
    ],
  ]);

  it("tells a struct value from a block by the declared struct names", () => {
    expect(parsesTo("struct S { int x; }\nint s = 1;\nif (s) { s = 2; }")).toBe(
      "(struct S (int x)) (var int s 1) (if s (block (expr (= s 2))))",
    );
  });
});

describe("functions", () => {
  table([
    ["int add(int a, int b) { return a + b; }", "(func int add (int a int b) (block (return (+ a b))))"],
    ["void f() { }", "(func void f () (block))"],
    ["int[] g(int[] xs) { return xs; }", "(func int[] g (int[] xs) (block (return xs)))"],
    ["string name() { return \"x\"; }", '(func string name () (block (return "x")))'],
    [
      `${PERSON}Person make(string n) { return Person{name: n}; }`,
      "(struct Person (string name) (int age)) (func Person make (string n) (block (return (struct Person name:n))))",
    ],
    ["{ int f() { return 1; } }", "(block (func int f () (block (return 1))))"],
  ]);
});

describe("statements", () => {
  table([
    ['System.out.println("a", 1);', '(print "a" 1)'],
    ["System.out.println();", "(print)"],
    ["System.out.println(typeof x);", "(print (typeof x))"],
    ["5;", "(expr 5)"],
    ["f(1);", "(expr (call f 1))"],
    ["x = -3;", "(expr (= x (- 3)))"],
    ["{ }", "(block)"],
    ["{ { int x = 1; } int y; }", "(block (block (var int x 1)) (var int y))"],
    ["return;", "(return)"],
    ["return 1 + 2;", "(return (+ 1 2))"],
    ["break; continue;", "(break) (continue)"],
    ["// c\nint x = 1; /* b */ int y;", "(var int x 1) (var int y)"],
  ]);
});

describe("++ and -- as statements (AC-06)", () => {
  table([
    ["i++;", "(++ i)"],
    ["i--;", "(-- i)"],
    ["a[0]--;", "(-- (idx a 0))"],
    ["m[1][2]++;", "(++ (idx (idx m 1) 2))"],
    ["p.age++;", "(++ (. p age))"],
    ["i += 1;", "(expr (+= i 1))"],
  ]);
});

describe("if", () => {
  table([
    ["if (a) b = 1;", "(if a (expr (= b 1)))"],
    ["if (a) { } else { }", "(if a (block) (block))"],
    ["if (a) x(); else if (b) y(); else z();", "(if a (expr (call x)) (if b (expr (call y)) (expr (call z))))"],
    ["if (a) if (b) x(); else y();", "(if a (if b (expr (call x)) (expr (call y))))"],
  ]);
});

describe("loops", () => {
  table([
    ["while (i < 3) i += 1;", "(while (< i 3) (expr (+= i 1)))"],
    ["while (true) { break; }", "(while true (block (break)))"],
    ["for (int i = 0; i < 10; i += 1) { }", "(for (var int i 0) (< i 10) (+= i 1) (block))"],
    ["for (int i = 0; i < n; i++) x();", "(for (var int i 0) (< i n) (++ i) (expr (call x)))"],
    ["for (i = 0; i < n; i--) { }", "(for (expr (= i 0)) (< i n) (-- i) (block))"],
    ["for (; i < n; i++) { }", "(for _ (< i n) (++ i) (block))"],
    ["for (float f = 0.5; f < 3; f = f + 1) { }", "(for (var float f 0.5) (< f 3) (= f (+ f 1)) (block))"],
    ["for (int v : xs) { }", "(foreach int v xs (block))"],
    ["for (var v : xs) { }", "(foreach var v xs (block))"],
    ["for (string s : names) print(s);", "(foreach string s names (expr (call print s)))"],
    ["for (Person p : people) { }", "(foreach Person p people (block))"],
  ]);
});

describe("switch", () => {
  table([
    [
      "switch (x) { case 1: a(); break; case 2: b(); default: c(); }",
      "(switch x (case 1 (expr (call a)) (break)) (case 2 (expr (call b))) (default (expr (call c))))",
    ],
    ["switch (x) { }", "(switch x)"],
    ["switch (x) { case 1: case 2: a(); }", "(switch x (case 1) (case 2 (expr (call a))))"],
    ["switch (x) { case 1: int y = 2; break; }", "(switch x (case 1 (var int y 2) (break)))"],
    ["switch (x) { default: a(); }", "(switch x (default (expr (call a))))"],
    ['switch (s) { case "a": f(); }', '(switch s (case "a" (expr (call f))))'],
  ]);
});
