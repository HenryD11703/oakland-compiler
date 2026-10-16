import { describe, expect, it } from "vitest";
import { check } from "../../src/core/check/check";
import { parse } from "../../src/core/parser/parser";
import { run } from "../../src/core/run";
import { corpus } from "../helpers/corpus";

/**
 * The interpreter finds type mistakes while it runs and the checker finds them without running (S-12, S-15).
 * They must agree:
 *  1. if the checker finds nothing, the interpreter must not report a type mistake (a "semantic" diagnostic);
 *  2. every type mistake the interpreter reports, the checker reports too, with the same words.
 * What the checker cannot know is a mistake in a *value* (parseInt("Hola")); those are left out of rule 2.
 */
const DEPENDS_ON_A_VALUE = /cannot convert|does not fit/;

const programs = corpus().filter((program) => parse(program.source).diagnostics.length === 0);

describe("the checker and the interpreter agree (S-15)", () => {
  it("has a corpus worth the name", () => {
    expect(programs.length).toBeGreaterThan(100);
  });

  it.each(programs.map((p) => [p.name, p.source] as const))("%s", (_name, source) => {
    const found = check(parse(source).program).diagnostics.map((d) => d.message);
    const ran = run(source, { trace: false, limits: { maxSteps: 2_000_000, maxTimeMs: 4_000 } });
    const semantic = ran.diagnostics.filter((d) => d.phase === "semantic" && !DEPENDS_ON_A_VALUE.test(d.message)).map((d) => d.message);

    if (found.length === 0) expect(semantic, "the checker approved, the interpreter did not").toEqual([]);
    const missing = semantic.filter((message) => !found.includes(message));
    expect(missing, "the interpreter reported what the checker did not").toEqual([]);
  });
});
