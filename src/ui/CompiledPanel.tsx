import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import type { CompileOutcome, CompiledFunction } from "../worker/protocol";

/** One line of WebAssembly text with its names, types, instructions and numbers coloured. */
const TOKEN = /(\$[\w:.]+)|\b(i32|f64)\b(?!\.)|\(\s*([a-z][a-z0-9_.]*)|(-?\b\d+\b)/g;
const KEYWORDS = new Set(["func", "param", "result", "local", "export", "import", "then", "else", "memory", "global", "data", "table", "elem", "module", "type", "block", "loop", "if"]);

export function WatLine({ text }: { text: string }): ReactNode {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(TOKEN)) {
    const at = match.index ?? 0;
    if (at > last) parts.push(text.slice(last, at));
    const [whole, name, type, word, number] = match;
    if (name !== undefined) parts.push(<span key={at} className="w-id">{name}</span>);
    else if (type !== undefined) parts.push(<span key={at} className="w-ty">{type}</span>);
    else if (word !== undefined) {
      parts.push(
        <Fragment key={at}>
          {whole.slice(0, whole.length - word.length)}
          <span className={KEYWORDS.has(word) ? "w-kw" : "w-op"}>{word}</span>
        </Fragment>,
      );
    } else if (number !== undefined) parts.push(<span key={at} className="w-num">{number}</span>);
    last = at + whole.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

export interface CompiledPanelProps {
  readonly outcome: CompileOutcome | null;
  readonly busy: boolean;
  /** The function the source cursor is in: it opens and comes into view. `nonce` makes the same name count again. */
  readonly focus: { readonly name: string; readonly nonce: number } | null;
  /** The source lines of a function of the program, to be marked and shown in the editor. */
  readonly onJump: (from: number, to: number) => void;
}

/**
 * The module's WebAssembly as text, one foldable block per function. A function of the program says which lines it came
 * from and points back at them; the functions every module carries (the allocator, strings, arrays) are folded.
 */
export function CompiledPanel({ outcome, busy, focus, onJump }: CompiledPanelProps) {
  // A new module (the page gives each its own key) opens the functions of the program and folds the rest.
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set((outcome?.functions ?? []).filter((f) => f.origin === "yours").map((f) => f.name)));
  const refs = useRef(new Map<string, HTMLElement>());

  // The cursor entered a function in the source: open it (once per move of the cursor) and bring it into view.
  const [seen, setSeen] = useState(focus?.nonce ?? 0);
  if (focus !== null && focus.nonce !== seen) {
    setSeen(focus.nonce);
    setOpen(new Set(open).add(focus.name));
  }
  useEffect(() => {
    if (focus === null) return;
    const frame = requestAnimationFrame(() => refs.current.get(focus.name)?.scrollIntoView({ block: "nearest" }));
    return () => cancelAnimationFrame(frame);
  }, [focus]);

  if (outcome === null) return <p className="empty wasm-empty">{busy ? "Compiling…" : "Press Compile to see the WebAssembly the program becomes."}</p>;
  if (!outcome.ok) {
    return (
      <p className="empty wasm-empty">
        The program was not compiled: {outcome.diagnostics.length} {outcome.diagnostics.length === 1 ? "problem" : "problems"}. They are listed under <b>Problems</b>, and a compiled program needs none.
      </p>
    );
  }
  const all = outcome.functions.length > 0 && open.size === outcome.functions.length;
  const toggle = (name: string): void => setOpen((before) => {
    const next = new Set(before);
    if (!next.delete(name)) next.add(name);
    return next;
  });

  return (
    <div className="wasm-body">
      <div className="wasm-head">
        <span className="label">WebAssembly</span>
        <span className="note">
          {outcome.watLines} lines · {outcome.functions.length} {outcome.functions.length === 1 ? "function" : "functions"}
        </span>
        <button type="button" className="mini" onClick={() => setOpen(all ? new Set() : new Set(outcome.functions.map((f) => f.name)))}>
          {all ? "Fold all" : "Unfold all"}
        </button>
      </div>
      <div className="wasm-list" data-testid="wasm">
        {outcome.functions.map((fn) => (
          <FunctionBlock key={fn.name} fn={fn} open={open.has(fn.name)} onToggle={() => toggle(fn.name)} onJump={onJump} register={(el) => (el ? refs.current.set(fn.name, el) : refs.current.delete(fn.name))} />
        ))}
      </div>
    </div>
  );
}

function FunctionBlock({ fn, open, onToggle, onJump, register }: { fn: CompiledFunction; open: boolean; onToggle: () => void; onJump: (from: number, to: number) => void; register: (el: HTMLElement | null) => void }) {
  return (
    <section className="wasm-fn" ref={register} data-fn={fn.name}>
      <div className="wasm-fnhead">
        <button type="button" className="wasm-toggle" aria-expanded={open} onClick={onToggle}>
          <span className="fold" aria-hidden="true">{open ? "▾" : "▸"}</span>
          <span className="fname">${fn.name}</span>
        </button>
        <span className={`chip ${fn.origin}`}>{fn.origin === "yours" ? "your code" : "runtime"}</span>
        {fn.source !== null ? (
          <button type="button" className="wasm-jump" onClick={() => onJump(fn.source?.from ?? 1, fn.source?.to ?? 1)}>
            ← source line{fn.source.from === fn.source.to ? ` ${fn.source.from}` : `s ${fn.source.from}–${fn.source.to}`}
          </button>
        ) : null}
        <span className="count">{fn.lines.length} lines</span>
      </div>
      {open ? (
        <pre className="wat">
          {fn.lines.map((line, i) => (
            <Fragment key={i}>
              <WatLine text={line} />
              {"\n"}
            </Fragment>
          ))}
        </pre>
      ) : null}
    </section>
  );
}
