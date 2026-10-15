import { useState } from "react";
import type { AstNode } from "../core/astView";
import type { Diagnostic } from "../core/diagnostics";
import type { Span } from "../core/span";
import type { SymbolEntry } from "../core/symbols";
import { type ReplayChanges, type ReplayState, renderValue } from "../core/trace/replay";

const NUMBER = new Intl.NumberFormat("en-US");
export const count = (n: number): string => NUMBER.format(n);

// ---------- variables ----------

export function VariablesTable({ state, changes }: { state: ReplayState | null; changes: ReplayChanges | null }) {
  if (!state) return <p className="empty">Run a program to see its variables.</p>;
  const frames = [...state.frames].reverse(); // the function being run first, then its callers, then the globals
  const rows = frames.flatMap((frame, i) => {
    const vars = frame.scopes.flatMap((scope) => scope.vars);
    const header = state.frames.length > 1 ? [{ key: `frame-${i}`, frame: frame.name }] : [];
    return [...header, ...vars.map((v) => ({ key: `var-${v.id}`, v }))];
  });
  if (rows.length === 0) return <p className="empty">No variables yet.</p>;
  return (
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Type</th>
          <th>Value</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) =>
          "frame" in row ? (
            <tr className="frame" key={row.key}>
              <td colSpan={3}>{row.frame === "global" ? "global" : `${row.frame}()`}</td>
            </tr>
          ) : (
            <tr key={row.key} className={changes?.variables.has(row.v.id) ? "changed" : undefined}>
              <td className="name">{row.v.name}</td>
              <td className="type">{row.v.type}</td>
              <td className="value" title={renderValue(state, row.v.value, row.v.type, true)}>
                {renderValue(state, row.v.value, row.v.type, true)}
              </td>
            </tr>
          ),
        )}
      </tbody>
    </table>
  );
}

// ---------- output ----------

export function OutputView({ text, total, ran }: { text: string; total: number; ran: boolean }) {
  if (!ran) return <p className="empty">The program has not run: fix the problems first.</p>;
  const lines = text === "" ? 0 : text.replace(/\n$/, "").split("\n").length;
  return (
    <>
      <pre className="out" data-testid="output" tabIndex={0} aria-label="Program output">
        {text === "" ? "" : text.replace(/\n$/, "")}
      </pre>
      <p className="rows">
        {count(lines)} of {count(total)} {total === 1 ? "line" : "lines"} printed
      </p>
    </>
  );
}

// ---------- problems ----------

export function ProblemsList({ diagnostics, onPick }: { diagnostics: readonly Diagnostic[]; onPick: (span: Span) => void }) {
  if (diagnostics.length === 0) return <p className="empty">No problems.</p>;
  return (
    <ul className="problems" data-testid="problems">
      {diagnostics.map((d, i) => (
        <li key={`${d.span.start.offset}-${i}`}>
          <button type="button" onClick={() => onPick(d.span)}>
            <span className="phase">{d.phase}</span>
            <span className="where">
              {d.span.start.line}:{d.span.start.column}
            </span>
            <span>{d.message}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

// ---------- syntax tree ----------

function TreeNode({ node, depth, onPick }: { node: AstNode; depth: number; onPick: (span: Span) => void }) {
  const [open, setOpen] = useState(depth < 2);
  const hasChildren = node.children.length > 0;
  return (
    <li>
      <div className="tree-row">
        {hasChildren ? (
          <button type="button" className="tree-toggle" aria-expanded={open} aria-label={`${open ? "Collapse" : "Expand"} ${node.kind}`} onClick={() => setOpen(!open)}>
            {open ? "▾" : "▸"}
          </button>
        ) : (
          <span className="tree-spacer" />
        )}
        <button type="button" className="tree-pick" onClick={() => onPick(node.span)}>
          <b>{node.kind}</b> <i>{node.label}</i>
        </button>
      </div>
      {hasChildren && open ? (
        <ul>
          {node.children.map((child, i) => (
            <TreeNode key={i} node={child} depth={depth + 1} onPick={onPick} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function AstTree({ ast, onPick }: { ast: AstNode | null; onPick: (span: Span) => void }) {
  if (!ast || ast.children.length === 0) return <p className="empty">Nothing to show yet.</p>;
  return (
    <ul className="tree" data-testid="tree">
      <TreeNode node={ast} depth={0} onPick={onPick} />
    </ul>
  );
}

// ---------- symbols ----------

export function SymbolsTable({ symbols, onPick }: { symbols: readonly SymbolEntry[]; onPick: (span: Span) => void }) {
  if (symbols.length === 0) return <p className="empty">No names declared yet.</p>;
  return (
    <table data-testid="symbols">
      <thead>
        <tr>
          <th>Name</th>
          <th>Kind</th>
          <th>Type</th>
          <th>Scope</th>
          <th>At</th>
        </tr>
      </thead>
      <tbody>
        {symbols.map((s) => (
          <tr key={`${s.span.start.offset}-${s.name}`}>
            <td className="name">
              <button type="button" className="symbol-pick" onClick={() => onPick(s.span)}>
                {s.name}
              </button>
            </td>
            <td className="type">{s.kind}</td>
            <td className="value">{s.type}</td>
            <td className="type">{s.scope}</td>
            <td className="type">
              {s.span.start.line}:{s.span.start.column}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
