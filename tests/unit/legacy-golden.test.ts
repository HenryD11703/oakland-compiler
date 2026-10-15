import { readdirSync, readFileSync } from "node:fs";
import { join, parse } from "node:path";
import { describe, expect, it } from "vitest";

const fixtures = join(import.meta.dirname, "..", "fixtures", "prueba");
const legacy = join(import.meta.dirname, "..", "golden", "legacy");
const slug = (file: string) => parse(file).name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

describe("legacy capture (T02)", () => {
  const programs = readdirSync(fixtures);

  it("keeps the seven original sample programs", () => {
    expect(programs).toHaveLength(7);
  });

  it.each(programs)("has the original interpreter's output for %s", (file) => {
    const name = slug(file);
    const stdout = readFileSync(join(legacy, `${name}.stdout.txt`), "utf8");
    const report = JSON.parse(readFileSync(join(legacy, `${name}.diagnostics.json`), "utf8"));
    expect(stdout.length).toBeGreaterThan(0);
    expect(report.source).toBe(file);
    // The original interpreter ran every sample to the end without a host exception.
    expect(report.hostError).toBeNull();
  });

  it("froze the clock for time() so the capture is reproducible", () => {
    expect(readFileSync(join(legacy, "4-funciones.stdout.txt"), "utf8")).toContain("2024-09-20T12:00:00.000Z");
  });
});
