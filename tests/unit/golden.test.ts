import { readdirSync, readFileSync } from "node:fs";
import { join, parse as parsePath } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../../src/core/run";
import { lineDiff } from "../helpers/linediff";

/**
 * Golden files (AC-19, AC-22).
 *   tests/golden/current/       what the rebuilt interpreter prints for each sample: the regression suite
 *   tests/golden/legacy-diff/   how that differs from what the original interpreter printed (tests/golden/legacy)
 *
 * Both are Vitest file snapshots: a change makes the test fail until the new text is reviewed and accepted
 * with \`npx vitest run -u\`. The legacy-diff files are the evidence behind docs/language-changes.md.
 */
const fixtures = join(import.meta.dirname, "..", "fixtures", "prueba");
const golden = join(import.meta.dirname, "..", "golden");
const slug = (file: string): string => parsePath(file).name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// time() reads the clock; the original capture froze it to this instant, so the new run does too.
const FIXED_NOW = Date.parse("2024-09-20T12:00:00.000Z");

const programs = readdirSync(fixtures).sort();

describe.each(programs)("%s", (file) => {
  const source = readFileSync(join(fixtures, file), "utf8");
  const result = run(source, { now: () => FIXED_NOW });
  const name = slug(file);

  it("prints what the golden file says", async () => {
    await expect(result.stdout).toMatchFileSnapshot(join(golden, "current", `${name}.stdout.txt`));
  });

  it("reports the diagnostics the golden file says", async () => {
    const lines = result.diagnostics.map((d) => `${d.span.start.line}:${d.span.start.column} ${d.phase}: ${d.message}`);
    await expect(lines.join("\n") + (lines.length ? "\n" : "")).toMatchFileSnapshot(join(golden, "current", `${name}.diagnostics.txt`));
  });

  it("differs from the original interpreter in the way the diff file says", async () => {
    const legacy = readFileSync(join(golden, "legacy", `${name}.stdout.txt`), "utf8").split("\n");
    const now = result.stdout.split("\n");
    await expect(lineDiff(legacy, now).join("\n") + "\n").toMatchFileSnapshot(join(golden, "legacy-diff", `${name}.diff.txt`));
  });
});
