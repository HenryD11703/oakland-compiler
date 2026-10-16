import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import { clamp, sizeAfterKey } from "./layout";

interface Props {
  /** `vertical` is a vertical bar that changes a width; `horizontal` is a horizontal bar that changes a height. */
  orientation: "vertical" | "horizontal";
  /** The panel whose size this divider changes. */
  target: RefObject<HTMLElement | null>;
  label: string;
  min: number;
  /** The most the panel may take now; read when the person drags, because it depends on the window. */
  max: () => number;
  /** +1 if moving the bar right/down makes the panel bigger, -1 if it makes it smaller. */
  grow: 1 | -1;
  onResize: (size: number) => void;
  onReset: () => void;
}

const sizeOf = (element: HTMLElement, orientation: Props["orientation"]): number =>
  orientation === "vertical" ? element.getBoundingClientRect().width : element.getBoundingClientRect().height;

/**
 * A divider between two panels: dragged with a mouse or a finger, or moved with the arrow keys
 * (Shift for bigger steps, Home/End for the limits, Enter or a double click for the default).
 */
export function Splitter({ orientation, target, label, min, max, grow, onResize, onReset }: Props) {
  const drag = useRef<{ start: number; size: number } | null>(null);
  const [now, setNow] = useState({ size: min, max: min });
  const [dragging, setDragging] = useState(false);

  // Keep the announced value true when the window or the panel changes size.
  useEffect(() => {
    const panel = target.current;
    if (!panel || typeof ResizeObserver === "undefined") return;
    const read = (): void => setNow({ size: Math.round(sizeOf(panel, orientation)), max: Math.max(min, Math.round(max())) });
    const observer = new ResizeObserver(read);
    observer.observe(panel);
    if (panel.parentElement) observer.observe(panel.parentElement);
    return () => observer.disconnect();
  }, [target, orientation, min, max]);

  const current = (): number => (target.current ? sizeOf(target.current, orientation) : 0);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { start: orientation === "vertical" ? event.clientX : event.clientY, size: current() };
    setDragging(true);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (!drag.current) return;
    const position = orientation === "vertical" ? event.clientX : event.clientY;
    onResize(Math.round(clamp(drag.current.size + grow * (position - drag.current.start), min, max())));
  };
  const stop = (): void => {
    drag.current = null;
    setDragging(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Enter") {
      event.preventDefault();
      onReset();
      return;
    }
    const next = sizeAfterKey(event.key, event.shiftKey, current(), orientation, grow, min, max());
    if (next === null) return;
    event.preventDefault();
    onResize(Math.round(next));
  };

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={orientation === "vertical" ? "vertical" : "horizontal"}
      aria-valuemin={min}
      aria-valuemax={now.max}
      aria-valuenow={clamp(now.size, min, now.max)}
      className={`splitter ${orientation}${dragging ? " dragging" : ""}`}
      title={`${label}. Drag, or use the arrow keys. Double click to reset.`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
    />
  );
}
