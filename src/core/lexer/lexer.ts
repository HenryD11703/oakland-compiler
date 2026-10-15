import { diagnostic, type Diagnostic } from "../diagnostics";
import { LineIndex } from "../span";
import { KEYWORDS, PUNCTUATION, type Token, type TokenType } from "./tokens";

export interface LexOptions {
  /** Keep comments as `comment` tokens (the editor needs them to colour the text). */
  readonly includeComments?: boolean;
}

export interface LexResult {
  /** Always ends with one `eof` token. Characters that could not be read are not in the list. */
  readonly tokens: Token[];
  readonly diagnostics: Diagnostic[];
  readonly lines: LineIndex;
}

const ESCAPES: Readonly<Record<string, string>> = {
  n: "\n",
  t: "\t",
  r: "\r",
  "0": "\0",
  b: "\b",
  f: "\f",
  '"': '"',
  "'": "'",
  "\\": "\\",
};

const isDigit = (c: string | undefined): boolean => c !== undefined && c >= "0" && c <= "9";
const isNameStart = (c: string | undefined): boolean =>
  c !== undefined && ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_");
const isNamePart = (c: string | undefined): boolean => isNameStart(c) || isDigit(c);

export function tokenize(source: string, options: LexOptions = {}): LexResult {
  const lines = new LineIndex(source);
  const tokens: Token[] = [];
  const diagnostics: Diagnostic[] = [];
  let i = 0;

  const emit = (type: TokenType, start: number, end: number, value: number | string | null = null): void => {
    tokens.push({ type, text: source.slice(start, end), span: lines.spanOf(start, end), value });
  };
  const report = (message: string, start: number, end: number): void => {
    diagnostics.push(diagnostic("lexical", message, lines.spanOf(start, end)));
  };

  /** Reads one possibly-escaped character at `at`. Returns the decoded text and how many characters it used. */
  const readChar = (at: number): { text: string; length: number } => {
    const c = source[at] as string;
    if (c !== "\\") return { text: c, length: 1 };
    const next = source[at + 1];
    if (next === undefined || next === "\n") return { text: "\\", length: 1 };
    const decoded = ESCAPES[next];
    if (decoded === undefined) {
      report(`unknown escape sequence '\\${next}'`, at, at + 2);
      return { text: next, length: 2 };
    }
    return { text: decoded, length: 2 };
  };

  while (i < source.length) {
    const c = source[i] as string;

    if (c === " " || c === "\t" || c === "\r" || c === "\n") {
      i++;
      continue;
    }

    // Comments
    if (c === "/" && source[i + 1] === "/") {
      const start = i;
      while (i < source.length && source[i] !== "\n") i++;
      if (options.includeComments) emit("comment", start, i);
      continue;
    }
    if (c === "/" && source[i + 1] === "*") {
      const start = i;
      const close = source.indexOf("*/", i + 2);
      if (close === -1) {
        i = source.length;
        report("unterminated block comment (it needs a closing */)", start, i);
      } else {
        i = close + 2;
      }
      if (options.includeComments) emit("comment", start, i);
      continue;
    }

    // Names and keywords: read the whole word first, so `trueValue` is one name and not `true` + `Value`.
    if (isNameStart(c)) {
      const start = i;
      while (isNamePart(source[i])) i++;
      emit(KEYWORDS.has(source.slice(start, i)) ? "keyword" : "identifier", start, i);
      continue;
    }

    // Numbers: `12` is an int, `12.5` a float. `12.` followed by a non-digit is the int 12 and a dot.
    if (isDigit(c)) {
      const start = i;
      while (isDigit(source[i])) i++;
      if (source[i] === "." && isDigit(source[i + 1])) {
        i++;
        while (isDigit(source[i])) i++;
        emit("float", start, i, Number(source.slice(start, i)));
      } else {
        emit("int", start, i, Number(source.slice(start, i)));
      }
      continue;
    }

    if (c === '"') {
      const start = i;
      i++;
      let text = "";
      let closed = false;
      while (i < source.length && source[i] !== "\n") {
        if (source[i] === '"') {
          closed = true;
          i++;
          break;
        }
        const piece = readChar(i);
        text += piece.text;
        i += piece.length;
      }
      if (closed) emit("string", start, i, text);
      else report("unterminated string (a string must end with \" on the same line)", start, i);
      continue;
    }

    if (c === "'") {
      const start = i;
      i++;
      if (i >= source.length || source[i] === "\n" || source[i] === "'") {
        const closedEmpty = source[i] === "'";
        if (closedEmpty) i++;
        report(closedEmpty ? "empty character literal" : "unterminated character literal", start, i);
        continue;
      }
      const piece = readChar(i);
      i += piece.length;
      if (source[i] === "'") {
        i++;
        emit("char", start, i, piece.text);
      } else {
        // Something like 'ab' or 'a: skip to the closing quote on this line, if there is one.
        while (i < source.length && source[i] !== "\n" && source[i] !== "'") i++;
        const closed = source[i] === "'";
        if (closed) i++;
        report(closed ? "a character literal must hold exactly one character" : "unterminated character literal", start, i);
      }
      continue;
    }

    const punct = PUNCTUATION.find((p) => source.startsWith(p, i));
    if (punct !== undefined) {
      emit("punct", i, i + punct.length);
      i += punct.length;
      continue;
    }

    if (c === "&" || c === "|") {
      report(`'${c}' is not an operator in OakLand; did you mean '${c}${c}'?`, i, i + 1);
    } else {
      report(`unexpected character '${c}'`, i, i + 1);
    }
    i++;
  }

  tokens.push({ type: "eof", text: "", span: lines.spanOf(source.length, source.length), value: null });
  return { tokens, diagnostics, lines };
}
