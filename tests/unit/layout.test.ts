import { describe, expect, it } from "vitest";
import { clamp, DEFAULT_LAYOUT, parseLayout, sizeAfterKey } from "../../src/ui/layout";

describe("keeping a panel between its limits", () => {
  it("clamps into the range", () => {
    expect(clamp(50, 100, 400)).toBe(100);
    expect(clamp(250, 100, 400)).toBe(250);
    expect(clamp(900, 100, 400)).toBe(400);
  });

  it("lets the minimum win when the window is too small for it", () => {
    expect(clamp(300, 320, 200)).toBe(320);
    expect(clamp(10, 320, 200)).toBe(320);
  });
});

describe("moving a divider with the keyboard", () => {
  // A divider on the left edge of the right column: moving it right makes that column smaller (grow = -1).
  it("moves by 16 px, or 64 with Shift", () => {
    expect(sizeAfterKey("ArrowLeft", false, 500, "vertical", -1, 320, 900)).toBe(516);
    expect(sizeAfterKey("ArrowRight", false, 500, "vertical", -1, 320, 900)).toBe(484);
    expect(sizeAfterKey("ArrowLeft", true, 500, "vertical", -1, 320, 900)).toBe(564);
  });

  it("uses up and down for a horizontal divider, and ignores the other arrows", () => {
    expect(sizeAfterKey("ArrowDown", false, 200, "horizontal", 1, 72, 600)).toBe(216);
    expect(sizeAfterKey("ArrowUp", false, 200, "horizontal", 1, 72, 600)).toBe(184);
    expect(sizeAfterKey("ArrowLeft", false, 200, "horizontal", 1, 72, 600)).toBeNull();
    expect(sizeAfterKey("ArrowDown", false, 200, "vertical", 1, 72, 600)).toBeNull();
    expect(sizeAfterKey("a", false, 200, "horizontal", 1, 72, 600)).toBeNull();
  });

  it("stops at the limits, and Home and End jump to them", () => {
    expect(sizeAfterKey("ArrowLeft", true, 880, "vertical", -1, 320, 900)).toBe(900);
    expect(sizeAfterKey("ArrowRight", true, 330, "vertical", -1, 320, 900)).toBe(320);
    expect(sizeAfterKey("Home", false, 500, "vertical", -1, 320, 900)).toBe(320);
    expect(sizeAfterKey("End", false, 500, "vertical", -1, 320, 900)).toBe(900);
  });
});

describe("remembering the layout", () => {
  it("reads what was saved", () => {
    expect(parseLayout('{"side":612,"vars":140}')).toEqual({ side: 612, vars: 140 });
    expect(parseLayout('{"side":612.4}')).toEqual({ side: 612, vars: null });
  });

  it("falls back to the defaults for anything that is not a layout", () => {
    expect(parseLayout(null)).toEqual(DEFAULT_LAYOUT);
    expect(parseLayout("")).toEqual(DEFAULT_LAYOUT);
    expect(parseLayout("not json")).toEqual(DEFAULT_LAYOUT);
    expect(parseLayout("[1,2]")).toEqual(DEFAULT_LAYOUT);
    expect(parseLayout('{"side":"wide","vars":-4}')).toEqual(DEFAULT_LAYOUT);
    expect(parseLayout('{"side":1e9,"vars":null}')).toEqual(DEFAULT_LAYOUT);
  });
});
