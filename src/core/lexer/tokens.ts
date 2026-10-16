import type { Span } from "../span";

export type TokenType =
  | "identifier"
  | "keyword"
  | "int"
  | "float"
  | "string"
  | "char"
  | "punct"
  | "comment"
  | "eof";

export interface Token {
  readonly type: TokenType;
  /** The exact source text of the token. */
  readonly text: string;
  readonly span: Span;
  /** Decoded value of a literal: number for int/float, the unescaped text for string/char, otherwise null. */
  readonly value: number | string | null;
}

/** Words that cannot be used as names. A name may start with one (`trueValue`) but cannot be one. */
export const KEYWORDS: ReadonlySet<string> = new Set([
  "int",
  "float",
  "string",
  "boolean",
  "char",
  "void",
  "var",
  "struct",
  "class",
  "extends",
  "this",
  "super",
  "private",
  "public",
  "if",
  "else",
  "while",
  "for",
  "switch",
  "case",
  "default",
  "break",
  "continue",
  "return",
  "new",
  "true",
  "false",
  "null",
  "typeof",
]);

/** The types that can start a declaration without being a struct name. */
export const PRIMITIVE_TYPES: ReadonlySet<string> = new Set(["int", "float", "string", "boolean", "char"]);

/** Longest first, so that `+=` is never read as `+` followed by `=`. */
export const PUNCTUATION: readonly string[] = [
  "+=", "-=", "++", "--", "==", "!=", "<=", ">=", "&&", "||",
  "(", ")", "[", "]", "{", "}", ",", ";", ":", "?", ".", "+", "-", "*", "/", "%", "<", ">", "=", "!",
];

export function isPunct(token: Token, text: string): boolean {
  return token.type === "punct" && token.text === text;
}

export function isKeyword(token: Token, text: string): boolean {
  return token.type === "keyword" && token.text === text;
}

/** How a token is named in an error message. */
export function describeToken(token: Token): string {
  if (token.type === "eof") return "the end of the file";
  if (token.type === "string") return "a string";
  if (token.type === "char") return "a character";
  if (token.type === "int" || token.type === "float") return `the number ${token.text}`;
  return `'${token.text}'`;
}
