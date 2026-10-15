/** A point in the source text. `line` and `column` start at 1; `offset` is a UTF-16 index starting at 0. */
export interface Position {
  readonly offset: number;
  readonly line: number;
  readonly column: number;
}

/** A half-open range of source text: `start` is included, `end` is not. */
export interface Span {
  readonly start: Position;
  readonly end: Position;
}

/** Converts between offsets and line/column positions for one source text. */
export class LineIndex {
  /** Offset of the first character of each line. */
  private readonly lineStarts: number[] = [0];

  constructor(private readonly text: string) {
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) === 10) this.lineStarts.push(i + 1);
    }
  }

  get lineCount(): number {
    return this.lineStarts.length;
  }

  /** Offsets past the end of the text are clamped to the end. */
  positionAt(offset: number): Position {
    const clamped = Math.max(0, Math.min(offset, this.text.length));
    let low = 0;
    let high = this.lineStarts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if ((this.lineStarts[mid] as number) <= clamped) low = mid;
      else high = mid - 1;
    }
    return { offset: clamped, line: low + 1, column: clamped - (this.lineStarts[low] as number) + 1 };
  }

  /** Inverse of `positionAt`. Columns past the end of a line are clamped to that line's end. */
  offsetAt(line: number, column: number): number {
    const index = Math.max(1, Math.min(line, this.lineStarts.length)) - 1;
    const start = this.lineStarts[index] as number;
    const nextStart = this.lineStarts[index + 1];
    const lineEnd = nextStart === undefined ? this.text.length : nextStart - 1;
    return Math.min(start + Math.max(1, column) - 1, lineEnd);
  }

  spanOf(startOffset: number, endOffset: number): Span {
    return { start: this.positionAt(startOffset), end: this.positionAt(endOffset) };
  }
}

/** The smallest span that covers both. */
export function joinSpans(first: Span, last: Span): Span {
  return { start: first.start, end: last.end };
}

/** A span that points between two characters (for example "a `;` is missing here"). */
export function isEmptySpan(span: Span): boolean {
  return span.start.offset === span.end.offset;
}

/** An empty span located at the end of `span`. */
export function endOf(span: Span): Span {
  return { start: span.end, end: span.end };
}

export function formatPosition(position: Position): string {
  return `${position.line}:${position.column}`;
}
