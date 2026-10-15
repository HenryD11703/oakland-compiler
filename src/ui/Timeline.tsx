import { type KeyboardEvent, type PointerEvent, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Series } from "../core/trace/series";
import type { Trace } from "../core/trace/types";
import { computeLanes, stepOfFraction } from "./timelineData";

interface TimelineProps {
  readonly trace: Trace;
  readonly series: readonly Series[];
  readonly lineCount: number;
  readonly totalOutput: number;
  /** The step shown now; -1 is before the first. */
  readonly step: number;
  readonly onSeek: (step: number) => void;
  readonly valueText: string;
}

const LANE_HEIGHT = { line: 50, conditions: 26, output: 30, series: 24 };
/** On a phone the lanes are shorter, so that the code keeps most of the screen. */
const LANE_HEIGHT_COMPACT = { line: 36, conditions: 20, output: 22, series: 18 };

/**
 * The whole run as lanes of time (direction B): which line was running, which conditions held, what had been
 * printed, and the values of the numeric variables that change most. One column per few steps, drawn from the
 * entire trace. The lane area is a slider: drag it, or use the keyboard.
 */
export function Timeline({ trace, series, lineCount, totalOutput, step, onSeek, valueText }: TimelineProps) {
  const frame = useRef<HTMLDivElement>(null);
  // Measured before the first paint, so that the lanes are computed once, at their real width.
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const node = frame.current;
    if (!node) return;
    const measure = (): void => setWidth(Math.max(200, Math.floor(node.clientWidth)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const lanes = useMemo(() => computeLanes(trace, series, lineCount, totalOutput, Math.max(width, 1)), [trace, series, lineCount, totalOutput, width]);
  const steps = trace.steps.length;

  const heights = width < 520 ? LANE_HEIGHT_COMPACT : LANE_HEIGHT;

  const geometry = useMemo(() => {
    const rows: { name: string; top: number; height: number }[] = [
      { name: "Line", top: 0, height: heights.line },
      { name: "If", top: heights.line, height: heights.conditions },
      { name: "Output", top: heights.line + heights.conditions, height: heights.output },
    ];
    let top = heights.line + heights.conditions + heights.output;
    for (const s of lanes.series) {
      rows.push({ name: s.name, top, height: heights.series });
      top += heights.series;
    }
    return { rows, total: top };
  }, [lanes, heights]);

  const paths = useMemo(() => {
    const { columns } = lanes;
    const cw = width / columns;
    const bar = cw > 4 ? cw - 1 : Math.max(1, cw);
    const x = (c: number): number => c * cw + (cw - bar) / 2;
    /** A filled bar of the lane's column width from y1 to y2; thin columns become 1px strokes. */
    const rect = (c: number, y1: number, y2: number): string => `M${x(c).toFixed(1)} ${y1.toFixed(1)}h${bar.toFixed(1)}v${(y2 - y1).toFixed(1)}h-${bar.toFixed(1)}z`;
    /** A thin line through the value at the end of each column; gaps where there is none. */
    const trace1 = (values: Float32Array, top: number, height: number, flip: boolean): string => {
      const pad = 4;
      let d = "";
      let drawing = false;
      for (let c = 0; c < columns; c++) {
        const v = values[c] as number;
        if (Number.isNaN(v)) {
          drawing = false;
          continue;
        }
        const y = top + pad + (flip ? v : 1 - v) * (height - pad * 2);
        d += `${drawing ? "L" : "M"}${(c * cw + cw / 2).toFixed(1)} ${y.toFixed(1)}`;
        drawing = true;
      }
      return d;
    };
    const lineLane = geometry.rows[0] as { top: number; height: number };
    const condLane = geometry.rows[1] as { top: number; height: number };
    const outLane = geometry.rows[2] as { top: number; height: number };
    // Conditions: each column is a bar split between the share that held (dark, from the top) and the rest (light).
    let held = "";
    let notHeld = "";
    const barTop = condLane.top + 4;
    const barHeight = condLane.height - 8;
    for (let c = 0; c < columns; c++) {
      const share = lanes.heldShare[c] as number;
      if (Number.isNaN(share)) continue;
      const split = barTop + share * barHeight;
      if (share > 0) held += rect(c, barTop, Math.max(split, barTop + 1));
      if (share < 1) notHeld += rect(c, split, barTop + barHeight);
    }
    let area = `M0 ${outLane.top + outLane.height - 2}`;
    for (let c = 0; c < columns; c++) {
      const y = outLane.top + outLane.height - 3 - (lanes.output[c] as number) * (outLane.height - 8);
      area += `L${(c * cw).toFixed(1)} ${y.toFixed(1)}L${((c + 1) * cw).toFixed(1)} ${y.toFixed(1)}`;
    }
    const outline = area;
    area += `L${width} ${outLane.top + outLane.height - 2}Z`;
    return {
      // line 1 is drawn at the top
      line: trace1(lanes.line, lineLane.top, lineLane.height, true),
      held,
      notHeld,
      area,
      outline,
      series: lanes.series.map((s, i) => {
        const row = geometry.rows[3 + i] as { top: number; height: number };
        return trace1(s.value, row.top, row.height, false);
      }),
    };
  }, [lanes, geometry, width]);

  const headX = step < 0 ? 0 : ((step + 0.5) / steps) * width;

  const seekFromPointer = (event: PointerEvent<HTMLDivElement>): void => {
    const box = event.currentTarget.getBoundingClientRect();
    onSeek(stepOfFraction((event.clientX - box.left) / box.width, steps));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const big = event.shiftKey ? 100 : 1;
    const moves: Record<string, number | undefined> = {
      ArrowLeft: -big,
      ArrowRight: big,
      ArrowDown: -big,
      ArrowUp: big,
      PageDown: -1000,
      PageUp: 1000,
    };
    if (event.key === "Home") onSeek(0);
    else if (event.key === "End") onSeek(steps - 1);
    else if (moves[event.key] !== undefined) onSeek(Math.max(0, Math.min(steps - 1, Math.max(step, 0) + (moves[event.key] as number))));
    else return;
    event.preventDefault();
  };

  return (
    <div className="lanes" data-testid="timeline">
      <div className="lane-labels" aria-hidden="true">
        {geometry.rows.map((row) => (
          <div key={row.name} style={{ height: row.height }}>
            {row.name}
          </div>
        ))}
      </div>
      <div className="chart" ref={frame}>
        <svg width={width} height={geometry.total} viewBox={`0 0 ${width} ${geometry.total}`} aria-hidden="true">
          {geometry.rows.slice(0, -1).map((row) => (
            <line key={row.name} x1={0} x2={width} y1={row.top + row.height + 0.5} y2={row.top + row.height + 0.5} stroke="#cdc5b0" />
          ))}
          <path d={paths.line} stroke="#14130f" strokeWidth={1} fill="none" />
          <path d={paths.held} fill="#14130f" />
          <path d={paths.notHeld} fill="#d8d0bb" />
          <path d={paths.area} fill="rgba(201,52,14,0.12)" />
          <path d={paths.outline} stroke="#c9340e" strokeWidth={1.2} fill="none" />
          {paths.series.map((d, i) => (
            <path key={lanes.series[i]?.name} d={d} stroke={i === 0 ? "#14130f" : "#675f4e"} strokeWidth={1} fill="none" />
          ))}
          <line x1={headX} x2={headX} y1={0} y2={geometry.total} stroke="#c9340e" strokeWidth={2} />
          <rect x={headX - 5} y={0} width={10} height={8} fill="#c9340e" />
        </svg>
        <div
          role="slider"
          tabIndex={0}
          aria-label="Step through the run"
          aria-valuemin={0}
          aria-valuemax={Math.max(0, steps - 1)}
          aria-valuenow={Math.max(0, step)}
          aria-valuetext={valueText}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            seekFromPointer(event);
          }}
          onPointerMove={(event) => {
            if (event.buttons) seekFromPointer(event);
          }}
          onKeyDown={onKeyDown}
          data-testid="scrubber"
        />
      </div>
    </div>
  );
}
