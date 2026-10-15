import { formatPosition, type Span } from "./span";

/**
 * Where in the pipeline the problem was found.
 * - `lexical`: a character or literal that cannot be turned into a token
 * - `syntax`: the tokens do not form a valid program
 * - `semantic`: the program is well formed but wrong (types, names, arguments)
 * - `runtime`: the program failed while running (bounds, division by zero, limits)
 */
export type Phase = "lexical" | "syntax" | "semantic" | "runtime";

/** Everything the interpreter has to say about a program. Plain data, safe to send between threads. */
export interface Diagnostic {
  readonly phase: Phase;
  readonly message: string;
  readonly span: Span;
}

export function diagnostic(phase: Phase, message: string, span: Span): Diagnostic {
  return { phase, message, span };
}

export function compareDiagnostics(a: Diagnostic, b: Diagnostic): number {
  return a.span.start.offset - b.span.start.offset || a.span.end.offset - b.span.end.offset;
}

/** `3:7 syntax: expected ';' after the declaration` */
export function formatDiagnostic(d: Diagnostic): string {
  return `${formatPosition(d.span.start)} ${d.phase}: ${d.message}`;
}
