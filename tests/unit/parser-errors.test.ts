import { describe, expect, it } from "vitest";
import { MAX_SYNTAX_ERRORS, parse } from "../../src/core/parser/parser";
import { showProgram } from "../helpers/sexpr";

/** [source, line, column, text the message must contain] */
type Case = readonly [string, number, number, string];

const check = (cases: readonly Case[]): void => {
  it.each(cases)("%j", (source, line, column, text) => {
    const { diagnostics } = parse(source);
    expect(diagnostics.length).toBeGreaterThan(0);
    const first = diagnostics[0];
    expect(first?.message).toContain(text);
    expect(first?.span.start).toMatchObject({ line, column });
  });
};

describe("a missing piece is reported just after the last good token (AC-20)", () => {
  check([
    ["int x = 5\nint y = 6;", 1, 10, "expected ';' after the declaration"],
    ['System.out.println("a")', 1, 24, "expected ';' after the statement"],
    ["x = 1", 1, 6, "expected ';' after the expression"],
    ["return 1", 1, 9, "expected ';' after return"],
    ["break", 1, 6, "expected ';' after 'break'"],
    ["if (x { }", 1, 6, "expected ')' after the condition"],
    ["while i < 3 { }", 1, 6, "expected '(' after 'while'"],
    ["f(1, 2", 1, 7, "expected ')' to close the call"],
    ["a[1", 1, 4, "expected ']' to close the index"],
    ["x = (1 + 2;", 1, 11, "expected ')' to close the parenthesis"],
    ["a ? b;", 1, 6, "expected ':' in the conditional expression"],
    ["new int;", 1, 8, "expected '[' with the array size after 'new int'"],
    ["{ int x = 1;", 1, 13, "expected '}' to close the block opened on line 1"],
    ["int f() { return 1;\n", 1, 20, "expected '}' to close the block opened on line 1"],
    ["for (int i = 0; i < 3) { }", 1, 22, "expected ';' after the loop condition"],
    ["int f(int a { }", 1, 12, "expected ')' to close the parameter list"],
    ["int f(int a)", 1, 13, "expected '{' to start the body of 'f'"],
    ["var x;", 1, 6, "'var' needs an initial value"],
  ]);
});

describe("an unexpected token is reported at the token", () => {
  check([
    ["int x = ;", 1, 9, "expected an expression, but found ';'"],
    ["int x = 1 + * 2;", 1, 13, "expected an expression, but found '*'"],
    ["f(1, );", 1, 6, "expected an expression, but found ')'"],
    ["int[5] a;", 1, 4, "expected a name after the type, but found '['"],
    ["int f(int) { }", 1, 10, "expected a name for the parameter, but found ')'"],
    ["int f(5) { }", 1, 7, "expected a parameter type, but found the number 5"],
    ["struct S { int ; }", 1, 16, "expected a name for the field, but found ';'"],
    ["struct S { 5 }", 1, 12, "expected a field like 'int age;'"],
    ["switch (x) { foo }", 1, 14, "expected 'case' or 'default', but found 'foo'"],
    ["x = ", 1, 4, "expected an expression"],
    ["int x =\nint y = 1;", 1, 8, "expected an expression"],
  ]);
});

describe("reserved words and misplaced words", () => {
  check([
    ["int int = 3;", 1, 5, "'int' is a reserved word and cannot be used as a name"],
    ["int while = 3;", 1, 5, "'while' is a reserved word"],
    ["void x = 1;", 1, 1, "a variable cannot have the type 'void'"],
    ["}", 1, 1, "unexpected '}': there is no open block to close"],
    ["else { }", 1, 1, "'else' without a matching 'if'"],
    ["case 1:", 1, 1, "'case' can only be used inside a switch"],
    ["default:", 1, 1, "'default' can only be used inside a switch"],
    ["if (a) int x = 1;", 1, 8, "a declaration is not allowed here; put it inside { }"],
    ["while (a) struct S { }", 1, 11, "a declaration is not allowed here"],
    ["switch (x) { default: a(); case 1: b(); }", 1, 28, "'default' must be the last part of a switch"],
    ["switch (x) { default: a(); default: b(); }", 1, 28, "a switch can only have one 'default'"],
  ]);
});

describe("++ and -- are statements, not expressions (AC-06)", () => {
  const message = "'++' and '--' can only be used as a statement or in the update part of a for loop";
  check([
    ["a[i++] = 1;", 1, 4, message],
    ["x = y++;", 1, 6, message],
    ["f(i--);", 1, 4, message],
    ["x = 1 + i++;", 1, 10, message],
    ["5++;", 1, 1, "'++' needs a variable, an array element or a struct field"],
    ["(i)++;", 1, 1, "needs a variable, an array element or a struct field"],
  ]);
});

describe("assignment targets", () => {
  check([
    ["1 = 2;", 1, 1, "the left side of an assignment must be a variable, an array element or a struct field"],
    ["f() = 2;", 1, 1, "the left side of an assignment"],
    ["a + b = 2;", 1, 1, "the left side of an assignment"],
  ]);
});

describe("lexical errors come with their own phase", () => {
  it.each([
    ["@", "unexpected character '@'"],
    ["a & b;", "did you mean '&&'"],
    ["/* open", "unterminated block comment"],
    ["'ab'", "exactly one character"],
  ])("%j", (source, text) => {
    const { diagnostics } = parse(source);
    expect(diagnostics[0]?.phase).toBe("lexical");
    expect(diagnostics[0]?.message).toContain(text);
  });

  it("does not add a confusing syntax error on the line of an unterminated string", () => {
    const { diagnostics } = parse('string s = "abc;\nint y = 1;');
    expect(diagnostics.map((d) => d.phase)).toEqual(["lexical"]);
  });

  it("still reports real syntax errors on other lines", () => {
    const { diagnostics } = parse('string s = "abc;\nint y = ;');
    expect(diagnostics.map((d) => `${d.phase}@${d.span.start.line}`)).toEqual(["lexical@1", "syntax@2"]);
  });
});

describe("recovery (AC-21)", () => {
  it("reports several errors in one run and keeps the good statements", () => {
    const result = parse("int a = ;\nint b = 2;\nint c = ;\nint d = 4;");
    expect(result.diagnostics.map((d) => d.span.start.line)).toEqual([1, 3]);
    expect(showProgram(result.program)).toBe("(var int b 2) (var int d 4)");
  });

  it("recovers inside a block without losing the rest of the program", () => {
    const result = parse("int f() { int x = ; return 1; }\nint g() { return 2; }");
    expect(result.diagnostics).toHaveLength(1);
    expect(showProgram(result.program)).toBe(
      "(func int f () (block (return 1))) (func int g () (block (return 2)))",
    );
  });

  it("recovers inside a switch case", () => {
    const result = parse("switch (x) { case 1: int y = ; break; case 2: b(); }");
    expect(result.diagnostics).toHaveLength(1);
    expect(showProgram(result.program)).toBe("(switch x (case 1 (break)) (case 2 (expr (call b))))");
  });

  it("stops after the maximum number of errors and says so", () => {
    const source = Array.from({ length: MAX_SYNTAX_ERRORS + 5 }, () => "int a = ;").join("\n");
    const result = parse(source);
    expect(result.diagnostics).toHaveLength(MAX_SYNTAX_ERRORS);
    expect(result.truncated).toBe(true);
  });

  it("does not set the truncated flag at exactly the maximum", () => {
    const source = Array.from({ length: MAX_SYNTAX_ERRORS }, () => "int a = ;").join("\n");
    const result = parse(source);
    expect(result.diagnostics).toHaveLength(MAX_SYNTAX_ERRORS);
    expect(result.truncated).toBe(false);
  });

  it("always terminates and never throws on nonsense", () => {
    const junk = [
      ")))", "((((", "}{}{", "int int int", "[[[", "] ] ]", ";;;;", "@@@", "\"", "'", "/*", "x = = = =",
      "for (", "for (;;", "switch (", "struct", "struct {", "if", "else else", "case case", "new new", "typeof typeof",
      "int[", "int[]", "int[] a = {", "a.", "a.(", "f(,", "{{{{{{{{{{", "}}}}}}}}}}", "++", "i ++ ++",
    ];
    for (const source of junk) {
      expect(() => parse(source), source).not.toThrow();
      expect(parse(source).diagnostics.length, source).toBeGreaterThan(0);
    }
  });

  it("parses an empty program", () => {
    const result = parse("   \n// nothing\n");
    expect(result.diagnostics).toEqual([]);
    expect(result.program.body).toEqual([]);
  });
});
