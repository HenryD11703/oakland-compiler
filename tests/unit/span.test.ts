import { describe, expect, it } from "vitest";
import { compareDiagnostics, diagnostic, formatDiagnostic } from "../../src/core/diagnostics";
import { endOf, isEmptySpan, joinSpans, LineIndex } from "../../src/core/span";

describe("LineIndex", () => {
  const text = "ab\ncd\n\nef";
  const lines = new LineIndex(text);

  it("counts lines", () => {
    expect(lines.lineCount).toBe(4);
    expect(new LineIndex("").lineCount).toBe(1);
  });

  it.each([
    [0, 1, 1],
    [1, 1, 2],
    [2, 1, 3], // the newline itself belongs to the line it ends
    [3, 2, 1],
    [5, 2, 3],
    [6, 3, 1], // empty line
    [7, 4, 1],
    [9, 4, 3], // end of text
  ])("offset %i is line %i column %i", (offset, line, column) => {
    expect(lines.positionAt(offset)).toEqual({ offset, line, column });
  });

  it("clamps offsets outside the text", () => {
    expect(lines.positionAt(-5).offset).toBe(0);
    expect(lines.positionAt(100)).toEqual({ offset: 9, line: 4, column: 3 });
  });

  it("converts back from line and column", () => {
    for (let offset = 0; offset <= text.length; offset++) {
      const { line, column } = lines.positionAt(offset);
      expect(lines.offsetAt(line, column)).toBe(offset);
    }
  });

  it("clamps columns past the end of a line", () => {
    expect(lines.offsetAt(1, 50)).toBe(2);
    expect(lines.offsetAt(99, 1)).toBe(7);
  });

  it("treats CRLF as one line break", () => {
    const crlf = new LineIndex("a\r\nb");
    expect(crlf.positionAt(3)).toEqual({ offset: 3, line: 2, column: 1 });
  });

  it("builds spans", () => {
    const span = lines.spanOf(3, 5);
    expect(span.start).toEqual({ offset: 3, line: 2, column: 1 });
    expect(span.end).toEqual({ offset: 5, line: 2, column: 3 });
  });
});

describe("span helpers", () => {
  const lines = new LineIndex("abc def");
  const first = lines.spanOf(0, 3);
  const last = lines.spanOf(4, 7);

  it("joins two spans", () => {
    expect(joinSpans(first, last)).toEqual(lines.spanOf(0, 7));
  });

  it("builds an empty span at the end of another", () => {
    expect(endOf(first)).toEqual(lines.spanOf(3, 3));
    expect(isEmptySpan(endOf(first))).toBe(true);
    expect(isEmptySpan(first)).toBe(false);
  });
});

describe("diagnostics", () => {
  const lines = new LineIndex("ab\ncd");

  it("formats as line:column phase: message", () => {
    expect(formatDiagnostic(diagnostic("syntax", "expected ';'", lines.spanOf(3, 4)))).toBe("2:1 syntax: expected ';'");
  });

  it("sorts by position", () => {
    const later = diagnostic("runtime", "b", lines.spanOf(3, 4));
    const earlier = diagnostic("lexical", "a", lines.spanOf(0, 1));
    expect([later, earlier].sort(compareDiagnostics)).toEqual([earlier, later]);
  });
});
