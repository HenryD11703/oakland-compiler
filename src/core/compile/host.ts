import type { Diagnostic } from "../diagnostics";
import { diagnostic } from "../diagnostics";
import { parseDecimalText, parseIntegerText } from "../interpreter/builtins";
import { formatFloat } from "../interpreter/values";
import type { Span } from "../span";

/**
 * The few things a compiled program asks of the page that runs it (plan D17). Everything else, including
 * turning an int into text, is compiled. They are listed here so that a reader can see the whole surface.
 */
export const HOST_IMPORTS = {
  /** A runtime mistake: `site` says which one (see `FailSite`), `a` and `b` fill the blanks in its message. Never returns. */
  fail: { params: ["i32", "i32", "i32"], results: [] },
  write_i32: { params: ["i32"], results: [] },
  write_f64: { params: ["f64"], results: [] },
  write_bool: { params: ["i32"], results: [] },
  /** One UTF-16 code unit. */
  write_char: { params: ["i32"], results: [] },
  /** A string object (a length, then its code units); 0 prints `null`. */
  write_string: { params: ["i32"], results: [] },
  /** A float as Java text: the host formats it and keeps the text, and answers with its length; `take_text` then copies it. */
  format_float: { params: ["f64"], results: ["i32"] },
  /** Copies the text of the last `format_float` to `ptr`, as 16-bit code units. */
  take_text: { params: ["i32"], results: [] },
  /** The built-ins that work on text: the host does the work and keeps the text, as `format_float` does, and answers with its length. */
  text_lower: { params: ["i32"], results: ["i32"] },
  text_upper: { params: ["i32"], results: ["i32"] },
  text_time: { params: [], results: ["i32"] },
  /**
   * `parseInt(s)` and `parseFloat(s)`. `site` is the first of a run of places that can fail: `site` itself for a null text,
   * `site + 1` for text that is not a number, `site + 2` for an int that does not fit. `{s}` in their messages is the text.
   */
  parse_int: { params: ["i32", "i32"], results: ["i32"] },
  parse_float: { params: ["i32", "i32"], results: ["f64"] },
  /** `a % b` for floats: the one operation WebAssembly has no instruction for. */
  fmod: { params: ["f64", "f64"], results: ["f64"] },
} as const;

export type HostName = keyof typeof HOST_IMPORTS;

/** A place in a compiled program where something can fail, and what to say if it does. */
export interface FailSite {
  readonly span: Span;
  /** `{0}` and `{1}` are replaced with the two numbers the program passes. */
  readonly message: string;
  /** What the interpreter calls this mistake. The built-in functions report theirs as `semantic`; everything else is `runtime`. */
  readonly phase?: "semantic";
}

/** The limits a compiled run keeps, the same as the interpreter's where they mean the same thing. */
export interface HostLimits {
  readonly maxOutputChars: number;
}

export const DEFAULT_HOST_LIMITS: HostLimits = { maxOutputChars: 200_000 };

/** Thrown by the host to stop a run: the program asked for it (`fail`) or went past a limit. */
export class RunFailure extends Error {
  constructor(
    readonly failure: Diagnostic,
  ) {
    super(failure.message);
  }
}

/** The text of a string object in memory: its length at `ptr`, then that many 16-bit code units. */
export function readString(memory: WebAssembly.Memory, ptr: number): string {
  if (ptr === 0) return "null";
  const length = new Uint32Array(memory.buffer, ptr, 1)[0] as number;
  const units = new Uint16Array(memory.buffer, ptr + 4, length);
  let text = "";
  // In pieces, so that a long string does not overflow the argument list of fromCharCode.
  for (let i = 0; i < length; i += 4096) text += String.fromCharCode(...units.subarray(i, Math.min(length, i + 4096)));
  return text;
}

/** What a compiled program printed and how it ended. */
export interface HostOutput {
  stdout: string;
}

/** Builds the `env` object a compiled module is instantiated with. `memory()` gives the module's memory once it exists. */
export function makeHost(sites: readonly FailSite[], limits: HostLimits, memory: () => WebAssembly.Memory, output: HostOutput): Record<HostName, (...args: never[]) => unknown> {
  let written = 0;
  let pending = "";
  let lastSite: FailSite | null = null;
  const emit = (text: string): void => {
    written += text.length;
    if (written > limits.maxOutputChars) {
      const span = lastSite?.span ?? { start: { offset: 0, line: 1, column: 1 }, end: { offset: 0, line: 1, column: 1 } };
      throw new RunFailure(diagnostic("runtime", `output limit reached (${limits.maxOutputChars.toLocaleString("en-US")} characters)`, span));
    }
    output.stdout += text;
  };
  const stop = (siteId: number, text: string): never => {
    const site = sites[siteId];
    if (site === undefined) throw new Error(`a compiled program failed at an unknown place (${siteId})`);
    lastSite = site;
    throw new RunFailure(diagnostic(site.phase ?? "runtime", site.message.replace("{s}", text), site.span));
  };
  return {
    text_lower: (ptr: number): number => {
      pending = readString(memory(), ptr).toLowerCase();
      return pending.length;
    },
    text_upper: (ptr: number): number => {
      pending = readString(memory(), ptr).toUpperCase();
      return pending.length;
    },
    text_time: (): number => {
      pending = new Date().toISOString();
      return pending.length;
    },
    parse_int: (ptr: number, site: number): number => {
      if (ptr === 0) return stop(site, "");
      const text = readString(memory(), ptr);
      const parsed = parseIntegerText(text);
      return parsed.ok ? parsed.value : stop(site + (parsed.reason === "text" ? 1 : 2), text);
    },
    parse_float: (ptr: number, site: number): number => {
      if (ptr === 0) return stop(site, "");
      const text = readString(memory(), ptr);
      const number = parseDecimalText(text);
      return number === null ? stop(site + 1, text) : number;
    },
    fail: (siteId: number, a: number, b: number): never => {
      const site = sites[siteId];
      if (site === undefined) throw new Error(`a compiled program failed at an unknown place (${siteId})`);
      lastSite = site;
      throw new RunFailure(diagnostic(site.phase ?? "runtime", site.message.replace("{0}", String(a)).replace("{1}", String(b)), site.span));
    },
    write_i32: (n: number): void => emit(String(n)),
    write_f64: (x: number): void => emit(formatFloat(x)),
    write_bool: (b: number): void => emit(b !== 0 ? "true" : "false"),
    write_char: (code: number): void => emit(String.fromCharCode(code & 0xffff)),
    write_string: (ptr: number): void => emit(readString(memory(), ptr)),
    format_float: (x: number): number => {
      pending = formatFloat(x);
      return pending.length;
    },
    take_text: (ptr: number): void => {
      const units = new Uint16Array(memory().buffer, ptr, pending.length);
      for (let i = 0; i < pending.length; i++) units[i] = pending.charCodeAt(i);
    },
    fmod: (a: number, b: number): number => a % b,
  } as unknown as Record<HostName, (...args: never[]) => unknown>;
}
