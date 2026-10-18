import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compile, runCompiled } from "../../src/core/compile/index";

/**
 * `docs/COMPILER.md` follows one program from its source to its bytes. This test compiles that program and requires the
 * WebAssembly text and the bytes on the page to be exactly what the compiler makes today, so the page cannot go stale.
 */
const page = readFileSync(join(import.meta.dirname, "..", "..", "docs", "COMPILER.md"), "utf8");
const example = page.slice(page.indexOf("## A worked example"));
const block = (language: string): string => {
  const match = new RegExp("```" + language + "\\n([\\s\\S]*?)\\n```").exec(example);
  if (!match) throw new Error(`no \`\`\`${language} block in the worked example`);
  return match[1] as string;
};

describe("docs/COMPILER.md: the worked example", () => {
  const source = block("oak") + "\n";
  const result = compile(source);

  it("compiles", () => {
    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("shows the WebAssembly text the compiler makes", () => {
    expect(block("wat")).toBe((result.wat as string).trimEnd());
  });

  it("shows the bytes the encoder makes, and says how many there are", () => {
    const bytes = [...(result.wasm as Uint8Array)].map((b) => b.toString(16).padStart(2, "0")).join(" ");
    expect(block("hex")).toBe(bytes);
    expect(example).toContain(`These are all ${(result.wasm as Uint8Array).length} of them`);
    expect(page).toContain(`is ${(result.wasm as Uint8Array).length} bytes`);
  });

  it("prints what the page says it prints", () => {
    expect(runCompiled(result).stdout).toBe("50\n");
  });
});
