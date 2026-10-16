import { describe, expect, it } from "vitest";
import { out, problems, runOak } from "../helpers/run";

/** Prints each expression on its own line and checks the whole output. */
const printed = (expressions: readonly string[]): string =>
  out(expressions.map((e) => `System.out.println(${e});`).join("\n"));

const table = (cases: ReadonlyArray<readonly [string, string]>): void => {
  it.each(cases)("%s", (expression, expected) => {
    expect(printed([expression])).toBe(expected);
  });
};

describe("int arithmetic is 32-bit, like Java (AC-01)", () => {
  table([
    ["7 / 2", "3"],
    ["-7 / 2", "-3"],
    ["7 % 3", "1"],
    ["-7 % 3", "-1"],
    ["7 % -3", "1"],
    ["10 / 5", "2"],
    ["2147483647 + 1", "-2147483648"],
    ["-2147483648", "-2147483648"],
    ["-2147483648 - 1", "2147483647"],
    ["100000 * 100000", "1410065408"],
    ["-(-2147483647 - 1)", "-2147483648"],
    ["-2 + (10 + 5) * 2 / 3 + 5 % 2", "9"],
    ["10 - 5 - 2", "3"],
    ["2 + 3 * 4", "14"],
    ["(2 + 3) * 4", "20"],
  ]);
});

describe("float arithmetic prints like Java (AC-02)", () => {
  table([
    ["10.5 + 5.5", "16.0"],
    ["10 + 5.5", "15.5"],
    ["10.5 + 5", "15.5"],
    ["10.5 - 5.5", "5.0"],
    ["10.5 * 5.5", "57.75"],
    ["10 * 5.5", "55.0"],
    ["10.5 / 5.5", "1.9090909090909092"],
    ["10 / 5.5", "1.8181818181818181"],
    ["7.0 / 2", "3.5"],
    ["5.5 % 2", "1.5"],
    ["0.1 + 0.2", "0.30000000000000004"],
    ["-10.5", "-10.5"],
    ["1.0 * 3", "3.0"],
  ]);
});

describe("division by zero (AC-03)", () => {
  it.each(["1 / 0", "1.5 / 0", "1 / 0.0", "5 % 0", "5.5 % 0"])("%s is one runtime diagnostic", (expression) => {
    const result = runOak(`System.out.println(${expression});`);
    expect(result.diagnostics.map((d) => [d.phase, d.message])).toEqual([["runtime", "division by zero"]]);
    expect(result.stdout).toBe("null\n");
  });

  it("does not cascade into the expression around it", () => {
    expect(problems("int x = (1 / 0) + 5 * 2; System.out.println(x);")).toEqual(["division by zero"]);
  });
});

describe("strings and characters (AC-04)", () => {
  table([
    ['"a" + "b"', "ab"],
    ['"n=" + 1', "n=1"],
    ['"f=" + 1.5', "f=1.5"],
    ['"f=" + 2.0', "f=2.0"],
    ['"b=" + true', "b=true"],
    ['"c=" + \'x\'', "c=x"],
    ['1 + "a"', "1a"],
    ["'a' + \"b\"", "ab"],
    ['"a" + 1 + 2', "a12"],
    ['1 + 2 + "a"', "3a"],
    ["'a' + 1", "98"],
    ["'a' + 'b'", "195"],
    ["'b' - 'a'", "1"],
    ['"a" == "a"', "true"],
    ['"a" == "b"', "false"],
    ['"a" != "b"', "true"],
    ['"a" < "b"', "true"],
    ['"b" <= "a"', "false"],
    ['"abc" > "abd"', "false"],
    ['"b" >= "b"', "true"],
    ["'a' < 'b'", "true"],
    ["'a' == 'a'", "true"],
    ["'a' == 97", "true"],
  ]);

  it("concatenates null as the word null", () => {
    expect(out('int x; System.out.println("v=" + x);')).toBe("v=null");
  });
});

describe("comparison", () => {
  table([
    ["10 == 10", "true"],
    ["10 == 5", "false"],
    ["10.5 == 10.5", "true"],
    ["1 == 1.0", "true"],
    ["10 != 10", "false"],
    ["10 > 5", "true"],
    ["10 >= 10", "true"],
    ["10.5 < 5.5", "false"],
    ["10 <= 10.0", "true"],
    ["true == true", "true"],
    ["true != false", "true"],
  ]);

  it("compares with null", () => {
    expect(printed(["null == null", "null != null"])).toBe("true\nfalse");
    expect(out("int x; System.out.println(x == null); x = 3; System.out.println(x == null);")).toBe("true\nfalse");
  });

  it("rejects values of unrelated types, once", () => {
    expect(problems('System.out.println("a" == 1);')).toEqual(["cannot compare string with int"]);
    expect(problems("System.out.println(true == 1);")).toEqual(["cannot compare boolean with int"]);
  });
});

describe("logic (AC-05)", () => {
  table([
    ["true && true", "true"],
    ["true && false", "false"],
    ["false || true", "true"],
    ["false || false", "false"],
    ["!true", "false"],
    ["!(10 == 11)", "true"],
    ["10 == 10 && 5 == 6", "false"],
    ["10 == 11 || 5 == 5", "true"],
    ["true || false && false", "true"],
  ]);

  it("short-circuits &&", () => {
    expect(out("int[] a = {1}; System.out.println(false && a[9] > 0);")).toBe("false");
  });

  it("short-circuits ||", () => {
    expect(out("int[] a = {1}; System.out.println(true || a[9] > 0);")).toBe("true");
  });

  it("evaluates the right side when the left does not decide", () => {
    expect(problems("int[] a = {1}; System.out.println(true && a[9] > 0);")).toEqual(["index 9 is out of range for an array of length 1"]);
  });

  it("needs booleans", () => {
    expect(problems("System.out.println(1 && true);")).toEqual(["cannot apply '&&' to int"]);
    expect(problems("System.out.println(true || 1);")).toEqual([]);
    expect(problems("System.out.println(false || 1);")).toEqual(["cannot apply '||' to int"]);
    expect(problems("System.out.println(!1);")).toEqual(["cannot apply '!' to int"]);
    expect(problems('System.out.println(-"a");')).toEqual(["cannot apply '-' to string"]);
  });
});

describe("ternary", () => {
  table([
    ["true ? 1 : 2", "1"],
    ["false ? 1 : 2", "2"],
    ["3 > 2 ? \"yes\" : \"no\"", "yes"],
    ["true ? 1 : 2.5", "1.0"],
    ["false ? 1 : 2.5", "2.5"],
    ["true ? 'a' : 1", "97"],
    ["true ? 1 : 'a'", "1"],
    ["false ? 'a' : 2.5", "2.5"],
    ["true ? 'a' : 'b'", "a"],
    ["false ? 1 : true ? 2 : 3", "2"],
  ]);

  it("only evaluates the chosen branch", () => {
    expect(out("int[] a = {1}; System.out.println(true ? 5 : a[9]);")).toBe("5");
  });

  it("needs a boolean condition", () => {
    expect(problems("System.out.println(1 ? 2 : 3);")).toEqual(["the condition must be boolean, but it is int"]);
  });
});

describe("typeof", () => {
  table([
    ["typeof 1", "int"],
    ["typeof 1.5", "float"],
    ['typeof "s"', "string"],
    ["typeof 'c'", "char"],
    ["typeof true", "boolean"],
    ["typeof null", "null"],
    ["typeof(1 + 2.0)", "float"],
  ]);
});

describe("type errors give one diagnostic and a null result (AC-09)", () => {
  it.each([
    ['"a" * 2', "cannot apply '*' to string and int"],
    ["true + 1", "cannot apply '+' to boolean and int"],
    ["true - false", "cannot apply '-' to boolean and boolean"],
    ['"a" - "b"', "cannot apply '-' to string and string"],
    ["true < false", "cannot apply '<' to boolean and boolean"],
    ['"a" < 1', "cannot apply '<' to string and int"],
  ])("%s", (expression, message) => {
    const result = runOak(`System.out.println(${expression});`);
    expect(result.diagnostics.map((d) => d.message)).toEqual([message]);
    expect(result.stdout).toBe("null\n");
  });

  it("does not report the same mistake twice through nested operators", () => {
    expect(problems('System.out.println(1 + ("a" * 2) - 3);')).toEqual(["cannot apply '*' to string and int"]);
  });

  it("rejects an int literal that does not fit", () => {
    expect(problems("System.out.println(2147483648);")).toEqual(["the number 2147483648 is too large for an int"]);
  });
});

describe("null in arithmetic", () => {
  it("is reported, not silently ignored", () => {
    expect(problems("int x; System.out.println(x + 1);")).toEqual(["cannot apply '+' to null"]);
    expect(problems("int x; System.out.println(-x);")).toEqual(["cannot apply '-' to null"]);
  });
});
