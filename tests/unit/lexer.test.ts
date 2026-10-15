import { describe, expect, it } from "vitest";
import { tokenize } from "../../src/core/lexer/lexer";
import type { Token } from "../../src/core/lexer/tokens";

const kinds = (source: string): string[] =>
  tokenize(source).tokens.filter((t) => t.type !== "eof").map((t) => `${t.type}:${t.text}`);

describe("names and keywords (AC-07)", () => {
  it("reads a word as one token before deciding whether it is a keyword", () => {
    expect(kinds("trueValue nullable integer format newItem returnCode ifx")).toEqual([
      "identifier:trueValue",
      "identifier:nullable",
      "identifier:integer",
      "identifier:format",
      "identifier:newItem",
      "identifier:returnCode",
      "identifier:ifx",
    ]);
  });

  it("recognises every reserved word", () => {
    const words = "int float string boolean char void var struct if else while for switch case default break continue return new true false null typeof";
    expect(tokenize(words).tokens.filter((t) => t.type === "keyword")).toHaveLength(23);
  });

  it("allows underscores and digits inside names", () => {
    expect(kinds("_a a_1 A9")).toEqual(["identifier:_a", "identifier:a_1", "identifier:A9"]);
  });

  it("treats System, out and println as ordinary names", () => {
    expect(kinds("System.out.println")).toEqual([
      "identifier:System", "punct:.", "identifier:out", "punct:.", "identifier:println",
    ]);
  });
});

describe("numbers", () => {
  it("reads ints and floats", () => {
    const tokens = tokenize("12 12.5 0 007").tokens;
    expect(tokens.slice(0, 4).map((t) => [t.type, t.value])).toEqual([
      ["int", 12], ["float", 12.5], ["int", 0], ["int", 7],
    ]);
  });

  it("does not take a dot as a decimal point unless a digit follows", () => {
    expect(kinds("12.length")).toEqual(["int:12", "punct:.", "identifier:length"]);
    expect(kinds("12.")).toEqual(["int:12", "punct:."]);
  });
});

describe("operators", () => {
  it("prefers the longest operator", () => {
    expect(kinds("i+=1; j-=2; k++; m--; a<=b; a>=b; a==b; a!=b; a&&b; a||b")).toEqual([
      "identifier:i", "punct:+=", "int:1", "punct:;",
      "identifier:j", "punct:-=", "int:2", "punct:;",
      "identifier:k", "punct:++", "punct:;",
      "identifier:m", "punct:--", "punct:;",
      "identifier:a", "punct:<=", "identifier:b", "punct:;",
      "identifier:a", "punct:>=", "identifier:b", "punct:;",
      "identifier:a", "punct:==", "identifier:b", "punct:;",
      "identifier:a", "punct:!=", "identifier:b", "punct:;",
      "identifier:a", "punct:&&", "identifier:b", "punct:;",
      "identifier:a", "punct:||", "identifier:b",
    ]);
  });

  it("reads single-character punctuation", () => {
    expect(kinds("( ) [ ] { } , ; : ? . + - * / % < > = !")).toHaveLength(20);
  });
});

describe("strings and characters", () => {
  it("decodes escapes", () => {
    const [string] = tokenize(String.raw`"a\nb\t\"q\"\\"`).tokens;
    expect(string?.type).toBe("string");
    expect(string?.value).toBe('a\nb\t"q"\\');
  });

  it("keeps the exact source text of a literal", () => {
    expect(tokenize(String.raw`"a\n"`).tokens[0]?.text).toBe(String.raw`"a\n"`);
  });

  it("reads characters, including escaped ones", () => {
    const tokens = tokenize(String.raw`'a' '\n' '\'' ' '`).tokens;
    expect(tokens.slice(0, 4).map((t) => [t.type, t.value])).toEqual([
      ["char", "a"], ["char", "\n"], ["char", "'"], ["char", " "],
    ]);
  });
});

describe("comments", () => {
  it("skips them by default", () => {
    expect(kinds("a // line\n/* block\nacross */ b")).toEqual(["identifier:a", "identifier:b"]);
  });

  it("keeps them when asked, for syntax colouring", () => {
    const tokens = tokenize("a // line\n/* b */", { includeComments: true }).tokens;
    expect(tokens.map((t) => t.type)).toEqual(["identifier", "comment", "comment", "eof"]);
  });

  it("does not read // inside a string", () => {
    expect(tokenize('"http://x"').tokens[0]?.value).toBe("http://x");
  });
});

describe("positions", () => {
  it("gives every token a 1-based line and column", () => {
    const tokens: Token[] = tokenize("int x;\n  y = 2;").tokens;
    const at = (text: string): Token => tokens.find((t) => t.text === text) as Token;
    expect(at("int").span.start).toEqual({ offset: 0, line: 1, column: 1 });
    expect(at("x").span.start).toEqual({ offset: 4, line: 1, column: 5 });
    expect(at("y").span.start).toEqual({ offset: 9, line: 2, column: 3 });
    expect(at("y").span.end).toEqual({ offset: 10, line: 2, column: 4 });
  });

  it("ends with an eof token at the end of the text", () => {
    const { tokens } = tokenize("ab\n");
    const eof = tokens[tokens.length - 1] as Token;
    expect(eof.type).toBe("eof");
    expect(eof.span.start).toEqual({ offset: 3, line: 2, column: 1 });
  });

  it("returns only eof for empty input", () => {
    expect(tokenize("").tokens.map((t) => t.type)).toEqual(["eof"]);
  });
});

describe("lexical errors", () => {
  const messages = (source: string): string[] => tokenize(source).diagnostics.map((d) => d.message);

  it("reports an unexpected character and keeps going", () => {
    const result = tokenize("a @ b");
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toBe("unexpected character '@'");
    expect(result.diagnostics[0]?.phase).toBe("lexical");
    expect(result.diagnostics[0]?.span.start).toMatchObject({ line: 1, column: 3 });
    expect(result.tokens.filter((t) => t.type === "identifier")).toHaveLength(2);
  });

  it("suggests && and || for a single & or |", () => {
    expect(messages("a & b")[0]).toContain("did you mean '&&'");
    expect(messages("a | b")[0]).toContain("did you mean '||'");
  });

  it("reports an unterminated string at the end of its line", () => {
    const result = tokenize('x = "abc\ny = 1;');
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("unterminated string");
    expect(result.diagnostics[0]?.span.start).toMatchObject({ line: 1, column: 5 });
    expect(result.tokens.some((t) => t.text === "y")).toBe(true);
  });

  it("reports an unterminated block comment", () => {
    expect(messages("a /* never closed")[0]).toContain("unterminated block comment");
  });

  it("reports bad character literals", () => {
    expect(messages("'ab'")[0]).toContain("exactly one character");
    expect(messages("''")[0]).toContain("empty character literal");
    expect(messages("'a")[0]).toContain("unterminated character literal");
  });

  it("reports an unknown escape but still produces the string", () => {
    const result = tokenize(String.raw`"a\qb"`);
    expect(result.diagnostics[0]?.message).toContain("unknown escape sequence '\\q'");
    expect(result.tokens[0]?.type).toBe("string");
  });
});
