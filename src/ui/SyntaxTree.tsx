import { useEffect, useMemo, useRef, useState } from "react";
import type { AstNode } from "../core/astView";
import type { Span } from "../core/span";

/**
 * The syntax tree drawn as a tree: the program at the left, each node to the right of its parent, joined by right-angled
 * lines. A node with children has a small box at its right edge that folds and unfolds it. The same component shows
 * inside the Views panel and, larger, as the whole view.
 */

const ROW = 30; // a node and the gap below it
const NODE_H = 24;
const CHAR = 7.6; // the width of one character of the 12 px monospaced font
const PAD = 10;
const GAP = 36; // between a column and the next
const TOGGLE = 14;
const MAX_LABEL = 30;
const ZOOMS = [0.6, 0.8, 1, 1.25, 1.5, 2];
const START_DEPTH = 3;

interface Placed {
  readonly node: AstNode;
  readonly id: string;
  readonly depth: number;
  readonly label: string;
  readonly foldable: boolean;
  readonly open: boolean;
  readonly children: Placed[];
  row: number;
}

const short = (text: string): string => (text.length > MAX_LABEL ? `${text.slice(0, MAX_LABEL - 1)}…` : text);
const widthOf = (p: Placed): number => Math.ceil((p.node.kind.length + (p.label === "" ? 0 : p.label.length + 1)) * CHAR) + PAD * 2 + (p.foldable ? TOGGLE + 4 : 0);

/** Places the nodes that are showing: a leaf takes the next row, a parent sits at the middle of its children. */
function place(root: AstNode, isOpen: (id: string, depth: number) => boolean): { nodes: Placed[]; rows: number } {
  const nodes: Placed[] = [];
  let next = 0;
  const walk = (node: AstNode, id: string, depth: number): Placed => {
    const foldable = node.children.length > 0;
    const open = foldable && isOpen(id, depth);
    const placed: Placed = { node, id, depth, label: short(node.label), foldable, open, children: [], row: 0 };
    nodes.push(placed);
    if (open) {
      placed.children.push(...node.children.map((child, i) => walk(child, `${id}.${i}`, depth + 1)));
      const first = placed.children[0] as Placed;
      const last = placed.children[placed.children.length - 1] as Placed;
      placed.row = (first.row + last.row) / 2;
    } else {
      placed.row = next++;
    }
    return placed;
  };
  walk(root, "0", 0);
  return { nodes, rows: next };
}

export interface SyntaxTreeProps {
  readonly ast: AstNode | null;
  /** Jump to the node in the code. */
  readonly onReveal: (span: Span) => void;
  /** In the panel: a button that opens the whole view. */
  readonly onFull?: () => void;
  /** In the whole view: a button that closes it. A click then selects a node instead of jumping at once. */
  readonly onClose?: () => void;
}

export function SyntaxTree({ ast, onReveal, onFull, onClose }: SyntaxTreeProps) {
  const [depth, setDepth] = useState(START_DEPTH);
  const [toggled, setToggled] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [zoom, setZoom] = useState(2); // an index into ZOOMS
  const [selected, setSelected] = useState<string | null>(null);
  const whole = onClose !== undefined;
  const scroller = useRef<HTMLDivElement>(null);

  const layout = useMemo(() => {
    if (!ast) return null;
    const { nodes, rows } = place(ast, (id, d) => toggled.get(id) ?? d < depth);
    // Every column is as wide as its widest node.
    const widths: number[] = [];
    for (const p of nodes) widths[p.depth] = Math.max(widths[p.depth] ?? 0, widthOf(p));
    const left: number[] = [];
    let at = 8;
    widths.forEach((w, d) => {
      left[d] = at;
      at += w + GAP;
    });
    const last = widths.length - 1;
    return { nodes, widths, left, width: (left[last] ?? 0) + (widths[last] ?? 0) + 8, height: Math.max(rows, 1) * ROW + 8 };
  }, [ast, depth, toggled]);

  // The drawing opens with the program at the left and in the middle of the box, not in an empty corner. The box has no
  // size while its tab is hidden, so this waits until it has one.
  const hasTree = layout !== null && ast !== null && ast.children.length > 0;
  const centred = useRef(false);
  useEffect(() => {
    centred.current = false; // a new program is drawn: centre it again
  }, [ast]);
  useEffect(() => {
    const box = scroller.current;
    if (!box || !hasTree || typeof ResizeObserver === "undefined") return;
    const centre = (): void => {
      if (centred.current || box.clientHeight === 0) return;
      const root = (layout.nodes[0] as Placed);
      box.scrollTop = Math.max(0, (root.row * ROW + 4 + NODE_H / 2) * (ZOOMS[2] as number) - box.clientHeight / 2);
      centred.current = true;
    };
    centre();
    const watch = new ResizeObserver(centre);
    watch.observe(box);
    return () => watch.disconnect();
  }, [hasTree, layout]);

  if (!ast || ast.children.length === 0 || !layout) return <p className="empty">Nothing to show yet.</p>;

  const scale = ZOOMS[zoom] as number;
  const x = (p: Placed): number => layout.left[p.depth] as number;
  const y = (p: Placed): number => p.row * ROW + 4;
  const chosen = selected === null ? null : (layout.nodes.find((p) => p.id === selected) ?? null);

  const fold = (p: Placed): void => setToggled(new Map(toggled).set(p.id, !p.open));
  const pick = (p: Placed): void => {
    if (whole) setSelected(p.id);
    else {
      setSelected(p.id);
      onReveal(p.node.span);
    }
  };
  const activate = (action: () => void) => (event: React.KeyboardEvent): void => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      action();
    }
  };

  const edges: string[] = [];
  for (const p of layout.nodes) {
    for (const child of p.children) {
      const x1 = x(p) + (layout.widths[p.depth] as number);
      const x2 = x(child);
      const middle = x1 + GAP / 2;
      edges.push(`M${x1} ${y(p) + NODE_H / 2}H${middle}V${y(child) + NODE_H / 2}H${x2}`);
    }
  }

  return (
    <div className={`syntax${whole ? " whole" : ""}`} data-testid="tree">
      <div className="tree-tools" role="toolbar" aria-label="Syntax tree controls">
        <button type="button" onClick={() => { setDepth(Infinity); setToggled(new Map()); }}>
          Expand all
        </button>
        <button type="button" onClick={() => { setDepth(2); setToggled(new Map()); }}>
          Collapse
        </button>
        <span className="sep" aria-hidden="true" />
        <button type="button" aria-label="Zoom out" disabled={zoom === 0} onClick={() => setZoom(zoom - 1)}>
          −
        </button>
        <span className="zoom" aria-live="polite">
          {Math.round(scale * 100)}%
        </span>
        <button type="button" aria-label="Zoom in" disabled={zoom === ZOOMS.length - 1} onClick={() => setZoom(zoom + 1)}>
          +
        </button>
        <span className="grow" />
        {onFull ? (
          <button type="button" onClick={onFull}>
            Full view ⤢
          </button>
        ) : null}
        {onClose ? (
          <button type="button" onClick={onClose}>
            Close ✕
          </button>
        ) : null}
      </div>

      <div className="tree-scroll" ref={scroller} tabIndex={0} role="region" aria-label="Syntax tree drawing">
        <svg width={layout.width * scale} height={layout.height * scale} viewBox={`0 0 ${layout.width} ${layout.height}`} role="group" aria-label={`Syntax tree, ${layout.nodes.length} nodes showing`}>
          <path className="tree-edges" d={edges.join("")} />
          {layout.nodes.map((p) => {
            const w = layout.widths[p.depth] as number;
            const text = p.label === "" ? p.node.kind : `${p.node.kind} ${p.label}`;
            return (
              <g key={p.id} transform={`translate(${x(p)} ${y(p)})`} className={p.id === selected ? "tree-node selected" : "tree-node"}>
                <g
                  className="tree-pick"
                  role="button"
                  tabIndex={0}
                  aria-label={text}
                  onClick={() => pick(p)}
                  onKeyDown={activate(() => pick(p))}
                >
                  <title>{p.node.label === "" ? p.node.kind : `${p.node.kind} ${p.node.label}`}</title>
                  <rect width={w} height={NODE_H} />
                  <text x={PAD} y={NODE_H / 2 + 4}>
                    <tspan className="kind">{p.node.kind}</tspan>
                    {p.label === "" ? null : <tspan className="text"> {p.label}</tspan>}
                  </text>
                </g>
                {p.foldable ? (
                  <g
                    className="tree-toggle"
                    role="button"
                    tabIndex={0}
                    aria-expanded={p.open}
                    aria-label={`${p.open ? "Collapse" : "Expand"} ${p.node.kind}`}
                    transform={`translate(${w - TOGGLE - 5} ${(NODE_H - TOGGLE) / 2})`}
                    onClick={() => fold(p)}
                    onKeyDown={activate(() => fold(p))}
                  >
                    <rect width={TOGGLE} height={TOGGLE} />
                    <text x={TOGGLE / 2} y={TOGGLE - 3.5}>
                      {p.open ? "−" : "+"}
                    </text>
                  </g>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>

      {whole ? (
        <div className="tree-detail" aria-live="polite">
          {chosen ? (
            <>
              <span>
                <b>{chosen.node.kind}</b> {chosen.node.label}
              </span>
              <span className="where">
                line {chosen.node.span.start.line}:{chosen.node.span.start.column}
              </span>
              <button type="button" onClick={() => onReveal(chosen.node.span)}>
                Show in code ▸
              </button>
            </>
          ) : (
            <span className="hint">Click a node to select it. The box on its right folds what is below it.</span>
          )}
        </div>
      ) : null}
    </div>
  );
}
