/** Sizes the person chose by dragging the dividers. `null` means "the default from the stylesheet". */
export interface Layout {
  /** Width in pixels of the right-hand column (state and views). */
  readonly side: number | null;
  /** Height in pixels of the variables panel. */
  readonly vars: number | null;
}

export const DEFAULT_LAYOUT: Layout = { side: null, vars: null };

const KEY = "oakland:layout";

/** Keyboard step in pixels; Shift makes it bigger. */
export const STEP = 16;
export const BIG_STEP = 64;

export function clamp(value: number, min: number, max: number): number {
  // If the room is smaller than the minimum, the minimum wins: a panel never collapses to nothing.
  return Math.max(min, Math.min(Math.max(min, max), value));
}

/**
 * The size a divider asks for after a key press, or `null` if the key does nothing to it.
 * `grow` is +1 when moving the divider right/down makes the panel bigger, -1 when it makes it smaller.
 */
export function sizeAfterKey(key: string, shift: boolean, size: number, orientation: "vertical" | "horizontal", grow: 1 | -1, min: number, max: number): number | null {
  const step = shift ? BIG_STEP : STEP;
  const forward = orientation === "vertical" ? "ArrowRight" : "ArrowDown";
  const back = orientation === "vertical" ? "ArrowLeft" : "ArrowUp";
  if (key === forward) return clamp(size + grow * step, min, max);
  if (key === back) return clamp(size - grow * step, min, max);
  if (key === "Home") return min;
  if (key === "End") return Math.max(min, max);
  return null;
}

function validSize(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value < 10_000 ? Math.round(value) : null;
}

export function parseLayout(raw: string | null): Layout {
  if (!raw) return DEFAULT_LAYOUT;
  try {
    const data: unknown = JSON.parse(raw);
    if (typeof data !== "object" || data === null) return DEFAULT_LAYOUT;
    const record = data as Record<string, unknown>;
    return { side: validSize(record.side), vars: validSize(record.vars) };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export function loadLayout(): Layout {
  try {
    return parseLayout(window.localStorage.getItem(KEY));
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export function saveLayout(layout: Layout): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(layout));
  } catch {
    // Storage can be blocked; the layout is only a convenience.
  }
}
