import { describe, expect, it } from "vitest";
import { expressionOf } from "../helpers/sexpr";

const table = (cases: ReadonlyArray<readonly [string, string]>): void => {
  it.each(cases)("%s", (source, expected) => {
    expect(expressionOf(source)).toBe(expected);
  });
};

describe("literals", () => {
  table([
    ["42", "42"],
    ["3.14", "3.14"],
    ['"hi"', '"hi"'],
    ["'c'", "'c'"],
    ["true", "true"],
    ["false", "false"],
    ["null", "null"],
    [String.raw`"a\nb"`, String.raw`"a\nb"`],
    [String.raw`'\n'`, String.raw`'\n'`],
  ]);
});

describe("names that begin with a keyword (AC-07)", () => {
  table([
    ["trueValue", "trueValue"],
    ["nullable", "nullable"],
    ["integer", "integer"],
    ["format", "format"],
    ["newItem", "newItem"],
    ["returnCode", "returnCode"],
    ["trueValue && nullable", "(&& trueValue nullable)"],
  ]);
});

describe("arithmetic precedence and associativity", () => {
  table([
    ["1 + 2 * 3", "(+ 1 (* 2 3))"],
    ["1 * 2 + 3", "(+ (* 1 2) 3)"],
    ["1 - 2 - 3", "(- (- 1 2) 3)"],
    ["8 / 4 / 2", "(/ (/ 8 4) 2)"],
    ["a % b * c", "(* (% a b) c)"],
    ["a * (b + c) / d", "(/ (* a (group (+ b c))) d)"],
    ["(1 + 2) * 3", "(* (group (+ 1 2)) 3)"],
    ["(a)", "(group a)"],
    ["1.5 * 2", "(* 1.5 2)"],
    ['s + "x" + 1', '(+ (+ s "x") 1)'],
  ]);
});

describe("unary operators bind tighter than binary ones", () => {
  table([
    ["-a * b", "(* (- a) b)"],
    ["- -a", "(- (- a))"],
    ["!!a", "(! (! a))"],
    ["!a && b", "(&& (! a) b)"],
    ["-3 * n / 2", "(/ (* (- 3) n) 2)"],
    ["a + -b", "(+ a (- b))"],
    ["a - -b", "(- a (- b))"],
    ["-x + y", "(+ (- x) y)"],
    ["!(a && b)", "(! (group (&& a b)))"],
  ]);
});

describe("comparison and logic", () => {
  table([
    ["i + 1 < n", "(< (+ i 1) n)"],
    ["a + b >= c - d", "(>= (+ a b) (- c d))"],
    ["a <= b", "(<= a b)"],
    ["a != b", "(!= a b)"],
    ["a < b == c > d", "(== (< a b) (> c d))"],
    ["a == b != c", "(!= (== a b) c)"],
    ["a || b && c", "(|| a (&& b c))"],
    ["a && b || c", "(|| (&& a b) c)"],
    ["a || b || c", "(|| (|| a b) c)"],
    ["a < b && b < c", "(&& (< a b) (< b c))"],
    ["x == null", "(== x null)"],
  ]);
});

describe("assignment", () => {
  table([
    ["x = 5", "(= x 5)"],
    ["x += 1", "(+= x 1)"],
    ["x -= 1", "(-= x 1)"],
    ["a = b = 3", "(= a (= b 3))"],
    ["x = y += 2", "(= x (+= y 2))"],
    ["i = i + 1", "(= i (+ i 1))"],
    ["a[0] = 1", "(= (idx a 0) 1)"],
    ["m[1][2] = 3", "(= (idx (idx m 1) 2) 3)"],
    ["p.age = 21", "(= (. p age) 21)"],
    ["p.pet.name = \"x\"", '(= (. (. p pet) name) "x")'],
  ]);
});

describe("conditional expression", () => {
  table([
    ["x = c ? 1 : 2", "(= x (? c 1 2))"],
    ["c ? a : d ? e : f", "(? c a (? d e f))"],
    ["a ? b : c || d", "(? a b (|| c d))"],
    ["a > 3 ? 1 : 2", "(? (> a 3) 1 2)"],
  ]);
});

describe("calls, indexes and members", () => {
  table([
    ["f()", "(call f)"],
    ["f(1, 2 + 3)", "(call f 1 (+ 2 3))"],
    ["f(g(1))", "(call f (call g 1))"],
    ["f(1)(2)", "(call (call f 1) 2)"],
    ["f(a)[0]", "(idx (call f a) 0)"],
    ["a[i + 1]", "(idx a (+ i 1))"],
    ["m[0][1]", "(idx (idx m 0) 1)"],
    ["a[b[0]]", "(idx a (idx b 0))"],
    ["a.length", "(. a length)"],
    ["a.indexOf(3)", "(call (. a indexOf) 3)"],
    ["a.join()", "(call (. a join))"],
    ["a.b.c.d", "(. (. (. a b) c) d)"],
    ["p.pets[0].name", "(. (idx (. p pets) 0) name)"],
    ["parseInt(\"12\") + 1", '(+ (call parseInt "12") 1)'],
  ]);
});

describe("typeof", () => {
  table([
    ["typeof x", "(typeof x)"],
    ["typeof x + 1", "(+ (typeof x) 1)"],
    ["typeof(x)", "(typeof (group x))"],
    ["typeof true", "(typeof true)"],
  ]);
});

describe("new", () => {
  table([
    ["new int[5]", "(new int 5)"],
    ["new int[2][3]", "(new int 2 3)"],
    ["new int[n + 1]", "(new int (+ n 1))"],
    ["new string[2][2][2]", "(new string 2 2 2)"],
    ["new Person[2]", "(new Person 2)"],
  ]);
});

describe("spans", () => {
  it("cover exactly the source of each node", async () => {
    const { parse } = await import("../../src/core/parser/parser");
    const source = "x = a + b * 2;";
    const statement = parse(source).program.body[0];
    if (statement?.kind !== "ExprStmt" || statement.expression.kind !== "Assign") throw new Error("shape");
    const assign = statement.expression;
    expect(source.slice(assign.span.start.offset, assign.span.end.offset)).toBe("x = a + b * 2");
    const sum = assign.value;
    expect(source.slice(sum.span.start.offset, sum.span.end.offset)).toBe("a + b * 2");
    if (sum.kind !== "Binary") throw new Error("shape");
    expect(source.slice(sum.right.span.start.offset, sum.right.span.end.offset)).toBe("b * 2");
    expect(statement.span.end.offset).toBe(source.length);
  });
});
