import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../../src/core/run";

/**
 * docs/LANGUAGE.md is executable. Each fenced block tagged `oak` is a program and must be followed by:
 *   an `output` block: exactly what it prints (may be empty), then
 *   optionally a `problems` block: its diagnostics, one `line:column message` per line.
 * Without a `problems` block the program must have no diagnostics.
 */
interface Example {
  readonly line: number;
  readonly program: string;
  readonly output: string;
  readonly problems: string[];
}

function parseBlocks(markdown: string): { tag: string; body: string; line: number }[] {
  const blocks: { tag: string; body: string; line: number }[] = [];
  const lines = markdown.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const open = /^```(\S*)\s*$/.exec(lines[i] as string);
    if (!open) {
      i++;
      continue;
    }
    const start = i + 1;
    const body: string[] = [];
    i++;
    while (i < lines.length && !/^```\s*$/.test(lines[i] as string)) {
      body.push(lines[i] as string);
      i++;
    }
    blocks.push({ tag: open[1] as string, body: body.join("\n"), line: start });
    i++;
  }
  return blocks;
}

function examplesOf(markdown: string): Example[] {
  const blocks = parseBlocks(markdown);
  const examples: Example[] = [];
  for (let b = 0; b < blocks.length; b++) {
    const block = blocks[b] as { tag: string; body: string; line: number };
    if (block.tag !== "oak") continue;
    const output = blocks[b + 1];
    if (output?.tag !== "output") throw new Error(`LANGUAGE.md line ${block.line}: an oak block must be followed by an output block`);
    const problems = blocks[b + 2]?.tag === "problems" ? (blocks[b + 2] as { body: string }).body.split("\n").filter((l) => l !== "") : [];
    examples.push({ line: block.line, program: block.body, output: output.body, problems });
  }
  return examples;
}

const markdown = readFileSync(join(import.meta.dirname, "..", "..", "docs", "LANGUAGE.md"), "utf8");
const examples = examplesOf(markdown);

describe("docs/LANGUAGE.md", () => {
  it("has plenty of examples", () => {
    expect(examples.length).toBeGreaterThanOrEqual(30);
  });

  it("has no oak block without an output block, and no stray output or problems blocks", () => {
    const tags = parseBlocks(markdown).map((b) => b.tag);
    expect(tags.filter((t) => !["oak", "output", "problems"].includes(t))).toEqual([]);
    expect(tags.filter((t) => t === "output").length).toBe(tags.filter((t) => t === "oak").length);
    expect(tags.filter((t) => t === "problems").length).toBeLessThanOrEqual(tags.filter((t) => t === "oak").length);
  });

  it.each(examples.map((e) => [`line ${e.line}`, e] as const))("example at %s prints and reports what the page says", (_where, example) => {
    const result = run(example.program);
    expect(result.stdout.replace(/\n$/, "")).toBe(example.output);
    expect(result.diagnostics.map((d) => `${d.span.start.line}:${d.span.start.column} ${d.message}`)).toEqual(example.problems);
  });
});

