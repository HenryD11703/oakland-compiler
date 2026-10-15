import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../../src/core/run";

const fixtures = join(import.meta.dirname, "..", "fixtures", "prueba");
const programs = new Map(readdirSync(fixtures).map((file) => [file, readFileSync(join(fixtures, file), "utf8")]));
const source = (file: string): string => programs.get(file) ?? "";

/**
 * The seven sample programs from the course. Four of them end with a comment block "SALIDA ESPERADA" (expected
 * output) written by hand by the course staff. It is not byte-exact, so the comparison ignores what the author
 * did not mean to be exact:
 *   - blank lines and repeated spaces (the Hanoi lines were written with single spaces);
 *   - quotes the author put around the text results of toString/toLowerCase/toUpperCase;
 *   - one expected line that is the source code of a println instead of its output.
 * Everything else must match line for line.
 */
function expectedOutput(text: string): string[] | null {
  const start = text.indexOf("SALIDA ESPERADA:");
  if (start === -1) return null;
  const block = text.slice(start + "SALIDA ESPERADA:".length, text.lastIndexOf("*/"));
  return normalise(
    block.split(/\r?\n/).map((line) => {
      const quoted = /^"(.*)"$/.exec(line.trim());
      if (quoted) return quoted[1] as string;
      const code = /^System\.out\.println\("(.*)"\);$/.exec(line.trim());
      return code ? (code[1] as string) : line;
    }),
  );
}

function normalise(lines: readonly string[]): string[] {
  return lines.map((line) => line.replace(/\s+/g, " ").trim()).filter((line) => line !== "");
}

const EXPECTED_DIAGNOSTICS: Readonly<Record<string, readonly string[]>> = {
  "1- Ciclos.txt": [],
  "2 - Bloques.txt": [],
  "4 - Funciones.txt": [],
  "arrays.oak": [],
  // The sample deliberately includes mistakes, to show how they are reported.
  "basicas.oak": ["cannot assign string to int", "cannot assign int to string"],
  "funciones.oak": [
    'parseInt cannot convert "Hola" to an int',
    "parseInt expects a string, but got float",
    'parsefloat cannot convert "Hola" to a float',
    "toLowerCase expects a string, but got int",
    "toUpperCase expects a string, but got int",
  ],
  "intermedias.oak": ["'a' is already declared in this scope"],
};

describe("the seven original programs (AC-19)", () => {
  it("are all present", () => {
    expect([...programs.keys()].sort()).toEqual(Object.keys(EXPECTED_DIAGNOSTICS).sort());
  });

  it.each([...programs.keys()])("%s runs to the end and reports exactly the expected mistakes", (file) => {
    const result = run(source(file));
    expect(result.ran).toBe(true);
    expect(result.stoppedEarly).toBe(false);
    expect(result.diagnostics.map((d) => d.message)).toEqual(EXPECTED_DIAGNOSTICS[file]);
    expect(result.diagnostics.every((d) => !d.message.startsWith("internal error"))).toBe(true);
  });

  it.each([...programs.keys()].filter((file) => expectedOutput(source(file)) !== null))(
    "%s prints what the course says it should",
    (file) => {
      const result = run(source(file));
      expect(normalise(result.stdout.split("\n"))).toEqual(expectedOutput(source(file)));
    },
  );

  it("draws the figure of 1- Ciclos.txt", () => {
    const lines = run(source("1- Ciclos.txt")).stdout.trimEnd().split("\n");
    expect(lines.length).toBeGreaterThan(10);
    expect(lines.every((line) => /^[*. ]+$/.test(line))).toBe(true);
    expect(lines.some((line) => line.includes("*"))).toBe(true);
  });
});
