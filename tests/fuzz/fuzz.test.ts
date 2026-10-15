import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tokenize } from "../../src/core/lexer/lexer";
import { run } from "../../src/core/run";
import { MAX_TRACE_STEPS } from "../../src/core/trace/types";

/**
 * AC-23: `run()` never throws and always returns a sound result, whatever the program says.
 * The programs are mutations of the seven samples and of a few programs that use every feature, plus random
 * soups of tokens. Everything is seeded, so a failure can be reproduced from the number in its name.
 */

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const fixtures = join(import.meta.dirname, "..", "fixtures", "prueba");
const FEATURES = `
struct Pet { string name; }
struct Person { string name; int age; Pet pet; }
int fib(int n) { if (n < 2) { return n; } return fib(n - 1) + fib(n - 2); }
void bump(int[] a) { for (int i = 0; i < a.length; i++) { a[i]++; } }
Person p = Person{name: "Ana", age: 20, pet: Pet{name: "Rex"}};
p.age += 2; p.pet.name = "Max";
int[] xs = {3, 1, 2}; int[][] m = new int[2][3]; bump(xs); m[1][2] = fib(10);
float f = 1; f += 0.5; char c = 'a'; string s = "v" + f + c + p.name;
for (int v : xs) { switch (v) { case 2: System.out.println("two"); break; default: System.out.println(v); } }
int k = 0; while (k < 3) { k++; if (k == 2) { continue; } System.out.println(s, k, xs.indexOf(3), xs.join()); }
boolean ok = k > 2 && !(f < 1) || p == null; System.out.println(ok ? "yes" : "no", typeof m, parseInt("12"), toUpperCase(s));
`;
const BASES: string[] = [
  ...readdirSync(fixtures).sort().map((file) => readFileSync(join(fixtures, file), "utf8")),
  FEATURES,
];

const WORDS = [
  "int", "float", "string", "boolean", "char", "void", "var", "struct", "if", "else", "while", "for", "switch", "case", "default",
  "break", "continue", "return", "new", "true", "false", "null", "typeof", "System", "out", "println", "length", "indexOf", "join",
  "parseInt", "toString", "x", "y", "i", "arr", "p", "Person", "f", "0", "1", "7", "2147483647", "3.5", '"s"', "'c'",
];
const PUNCT = ["(", ")", "[", "]", "{", "}", ",", ";", ":", "?", ".", "+", "-", "*", "/", "%", "<", ">", "=", "!", "==", "!=", "<=", ">=", "&&", "||", "++", "--", "+=", "-="];

type Mutator = (source: string, random: () => number) => string;

const pick = <T>(items: readonly T[], random: () => number): T => items[Math.floor(random() * items.length)] as T;

const MUTATORS: readonly Mutator[] = [
  // delete a token
  (source, random) => {
    const tokens = tokenize(source).tokens.filter((t) => t.type !== "eof");
    if (tokens.length === 0) return source;
    const t = pick(tokens, random);
    return source.slice(0, t.span.start.offset) + source.slice(t.span.end.offset);
  },
  // duplicate a token
  (source, random) => {
    const tokens = tokenize(source).tokens.filter((t) => t.type !== "eof");
    if (tokens.length === 0) return source;
    const t = pick(tokens, random);
    return source.slice(0, t.span.end.offset) + " " + t.text + source.slice(t.span.end.offset);
  },
  // replace a token with another token of the program
  (source, random) => {
    const tokens = tokenize(source).tokens.filter((t) => t.type !== "eof");
    if (tokens.length < 2) return source;
    const target = pick(tokens, random);
    const donor = pick(tokens, random);
    return source.slice(0, target.span.start.offset) + donor.text + source.slice(target.span.end.offset);
  },
  // replace a token with a random word or punctuation
  (source, random) => {
    const tokens = tokenize(source).tokens.filter((t) => t.type !== "eof");
    if (tokens.length === 0) return source;
    const t = pick(tokens, random);
    return source.slice(0, t.span.start.offset) + pick(random() < 0.5 ? WORDS : PUNCT, random) + source.slice(t.span.end.offset);
  },
  // delete a line
  (source, random) => {
    const lines = source.split("\n");
    lines.splice(Math.floor(random() * lines.length), 1);
    return lines.join("\n");
  },
  // duplicate a line
  (source, random) => {
    const lines = source.split("\n");
    const at = Math.floor(random() * lines.length);
    lines.splice(at, 0, lines[at] ?? "");
    return lines.join("\n");
  },
  // swap two lines
  (source, random) => {
    const lines = source.split("\n");
    const a = Math.floor(random() * lines.length);
    const b = Math.floor(random() * lines.length);
    [lines[a], lines[b]] = [lines[b] as string, lines[a] as string];
    return lines.join("\n");
  },
  // insert a character anywhere, quotes and comment openers included
  (source, random) => {
    const at = Math.floor(random() * (source.length + 1));
    return source.slice(0, at) + pick(['"', "'", "/*", "//", "@", "#", "\\", "&", "|", "{", "}", "\0", "é"], random) + source.slice(at);
  },
  // cut the program short
  (source, random) => source.slice(0, Math.floor(random() * source.length)),
  // wrap a piece in deep nesting
  (source, random) => {
    const at = Math.floor(random() * (source.length + 1));
    const depth = 1 + Math.floor(random() * 300);
    return source.slice(0, at) + (random() < 0.5 ? "(".repeat(depth) : "{".repeat(depth)) + source.slice(at);
  },
];

function mutate(random: () => number): string {
  let source = pick(BASES, random);
  const rounds = 1 + Math.floor(random() * 3);
  for (let i = 0; i < rounds; i++) source = pick(MUTATORS, random)(source, random);
  return source;
}

function soup(random: () => number): string {
  const length = 1 + Math.floor(random() * 60);
  return Array.from({ length }, () => pick(random() < 0.6 ? WORDS : PUNCT, random)).join(random() < 0.8 ? " " : "");
}

/** Everything a caller may rely on, whatever the input was. */
function checkSound(source: string, label: string): void {
  let result: ReturnType<typeof run>;
  try {
    result = run(source, { limits: { maxSteps: 300_000, maxTimeMs: 2_000 } });
  } catch (error) {
    throw new Error(`run() threw for ${label}: ${String(error)}\n--- source ---\n${source.slice(0, 600)}`, { cause: error });
  }
  const where = `${label}\n--- source ---\n${source.slice(0, 600)}`;
  expect(typeof result.stdout, where).toBe("string");
  if (!result.ran) expect(result.stdout, where).toBe("");
  for (const d of result.diagnostics) {
    expect(d.message.length, where).toBeGreaterThan(0);
    expect(d.message.startsWith("internal error"), `${d.message}\n${where}`).toBe(false);
    expect(["lexical", "syntax", "semantic", "runtime"], where).toContain(d.phase);
    expect(d.span.start.offset, where).toBeGreaterThanOrEqual(0);
    expect(d.span.end.offset, where).toBeLessThanOrEqual(source.length);
    expect(d.span.start.offset, where).toBeLessThanOrEqual(d.span.end.offset);
    expect(d.span.start.line, where).toBeGreaterThanOrEqual(1);
    expect(d.span.start.column, where).toBeGreaterThanOrEqual(1);
  }
  if (result.ran) expect(result.ast.kind, where).toBe("Program");
  if (result.trace) expect(result.trace.steps.length, where).toBeLessThanOrEqual(MAX_TRACE_STEPS + 1);
  // A program with a syntax or lexical error never runs; one that ran has none.
  const broken = result.diagnostics.some((d) => d.phase === "lexical" || d.phase === "syntax");
  expect(result.ran, where).toBe(!broken);
}

describe("fuzzing (AC-23)", () => {
  it("never throws on 1,000 mutations of the sample programs", { timeout: 120_000 }, () => {
    for (let seed = 1; seed <= 1000; seed++) {
      const random = mulberry32(seed);
      checkSound(mutate(random), `mutation #${seed}`);
    }
  });

  it("never throws on 500 random soups of tokens", { timeout: 60_000 }, () => {
    for (let seed = 1; seed <= 500; seed++) {
      const random = mulberry32(100_000 + seed);
      checkSound(soup(random), `soup #${seed}`);
    }
  });

  it("still runs the unmodified bases cleanly", () => {
    for (const [i, base] of BASES.entries()) {
      const result = run(base);
      expect(result.ran, `base #${i}`).toBe(true);
      expect(result.diagnostics.some((d) => d.message.startsWith("internal error")), `base #${i}`).toBe(false);
    }
  });

  it("is deterministic: the same seed makes the same program", () => {
    expect(mutate(mulberry32(42))).toBe(mutate(mulberry32(42)));
    expect(soup(mulberry32(7))).toBe(soup(mulberry32(7)));
  });
});
