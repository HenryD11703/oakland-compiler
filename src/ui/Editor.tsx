import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { type Diagnostic as CmDiagnostic, linter, setDiagnostics } from "@codemirror/lint";
import { EditorState, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, keymap, lineNumbers, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { Diagnostic } from "../core/diagnostics";
import { tokenize } from "../core/lexer/lexer";
import { PRIMITIVE_TYPES, type Token } from "../core/lexer/tokens";
import type { Span } from "../core/span";

/** A value to show at the end of a source line: `x = 8.0`. */
export interface InlineEntry {
  readonly line: number;
  readonly parts: readonly { readonly name: string; readonly value: string }[];
}

export interface EditorHandle {
  /** Replaces the whole text as one undoable change. */
  setText(text: string): void;
  /** Selects a range of the source and scrolls it into view. */
  reveal(span: Span): void;
  focus(): void;
}

interface EditorProps {
  readonly initialText: string;
  readonly onChange: (text: string) => void;
  readonly onRun: () => void;
  readonly diagnostics: readonly Diagnostic[];
  /** The source the interpreter is working on at the current step, to be marked. */
  readonly activeSpan: Span | null;
  readonly inline: readonly InlineEntry[];
}

// ---------- colouring, from the interpreter's own lexer ----------

function classOf(token: Token, next: Token | undefined): string | null {
  switch (token.type) {
    case "comment":
      return "cm";
    case "keyword":
      if (PRIMITIVE_TYPES.has(token.text) || token.text === "var" || token.text === "void") return "ty";
      if (token.text === "true" || token.text === "false" || token.text === "null") return "lit";
      return "kw";
    case "int":
    case "float":
      return "num";
    case "string":
    case "char":
      return "str";
    case "identifier":
      return next && next.type === "punct" && next.text === "(" ? "fn" : null;
    case "punct":
      return "p";
    default:
      return null;
  }
}

function colour(text: string): DecorationSet {
  const tokens = tokenize(text, { includeComments: true }).tokens;
  const ranges = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] as Token;
    if (token.type === "eof" || token.span.end.offset === token.span.start.offset) continue;
    const cls = classOf(token, tokens[i + 1]);
    if (cls) ranges.push(Decoration.mark({ class: `t-${cls}` }).range(token.span.start.offset, token.span.end.offset));
  }
  return Decoration.set(ranges, true);
}

const colouring = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = colour(view.state.doc.toString());
    }
    update(update: ViewUpdate): void {
      if (update.docChanged) this.decorations = colour(update.state.doc.toString());
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

// ---------- the step being shown: a marked line and values at line ends ----------

class InlineValue extends WidgetType {
  constructor(readonly parts: InlineEntry["parts"]) {
    super();
  }
  override eq(other: InlineValue): boolean {
    return this.parts.length === other.parts.length && this.parts.every((p, i) => p.name === other.parts[i]?.name && p.value === other.parts[i]?.value);
  }
  override toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-inline-value";
    this.parts.forEach((part, i) => {
      if (i > 0) span.append("  ");
      const value = part.value.length > 22 ? `${part.value.slice(0, 20)}…` : part.value;
      const strong = document.createElement("b");
      strong.textContent = value;
      span.append(`${part.name} = `, strong);
    });
    return span;
  }
  override ignoreEvent(): boolean {
    return true;
  }
}

interface Overlay {
  readonly span: Span | null;
  readonly inline: readonly InlineEntry[];
}
const setOverlay = StateEffect.define<Overlay>();

const overlayField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    let next = value.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (!effect.is(setOverlay)) continue;
      const doc = transaction.state.doc;
      const ranges = [];
      if (effect.value.span) {
        const first = Math.min(effect.value.span.start.line, doc.lines);
        const last = Math.min(effect.value.span.end.line, doc.lines);
        for (let n = first; n <= last; n++) ranges.push(Decoration.line({ class: "cm-active-step" }).range(doc.line(n).from));
      }
      for (const entry of effect.value.inline) {
        if (entry.line < 1 || entry.line > doc.lines) continue;
        ranges.push(Decoration.widget({ widget: new InlineValue(entry.parts), side: 1 }).range(doc.line(entry.line).to));
      }
      next = Decoration.set(ranges, true);
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

function toLint(diagnostic: Diagnostic, length: number): CmDiagnostic {
  let from = Math.min(diagnostic.span.start.offset, Math.max(0, length - 1));
  let to = Math.min(diagnostic.span.end.offset, length);
  if (to <= from) to = Math.min(length, from + 1);
  if (from >= to) from = Math.max(0, to - 1);
  return { from, to, severity: "error", message: diagnostic.message, source: diagnostic.phase };
}

export const Editor = forwardRef<EditorHandle, EditorProps>(function Editor({ initialText, onChange, onRun, diagnostics, activeSpan, inline }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const callbacks = useRef({ onChange, onRun });
  callbacks.current = { onChange, onRun };

  useEffect(() => {
    const parent = host.current;
    if (!parent) return;
    const state = EditorState.create({
      doc: initialText,
      extensions: [
        lineNumbers(),
        history(),
        keymap.of([
          {
            key: "Mod-Enter",
            run: () => {
              callbacks.current.onRun();
              return true;
            },
          },
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        linter(null),
        colouring,
        overlayField,
        EditorView.contentAttributes.of({ "aria-label": "OakLand source code", spellcheck: "false", autocapitalize: "off", autocorrect: "off", tabindex: "0" }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) callbacks.current.onChange(update.state.doc.toString());
        }),
      ],
    });
    const editor = new EditorView({ state, parent });
    view.current = editor;
    return () => {
      editor.destroy();
      view.current = null;
    };
    // The editor is created once; later changes arrive through the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    editor.dispatch(setDiagnostics(editor.state, diagnostics.map((d) => toLint(d, editor.state.doc.length))));
  }, [diagnostics]);

  useEffect(() => {
    view.current?.dispatch({ effects: setOverlay.of({ span: activeSpan, inline }) });
  }, [activeSpan, inline]);

  useEffect(() => {
    // Keep the marked line in sight while stepping.
    const editor = view.current;
    if (!editor || !activeSpan) return;
    const line = editor.state.doc.line(Math.min(activeSpan.start.line, editor.state.doc.lines));
    editor.dispatch({ effects: EditorView.scrollIntoView(line.from, { y: "nearest", yMargin: 48 }) });
  }, [activeSpan]);

  useImperativeHandle(ref, () => ({
    setText(text) {
      const editor = view.current;
      if (!editor) return;
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: text }, selection: { anchor: 0 }, scrollIntoView: true });
    },
    reveal(span) {
      const editor = view.current;
      if (!editor) return;
      const from = Math.min(span.start.offset, editor.state.doc.length);
      const to = Math.max(from, Math.min(span.end.offset, editor.state.doc.length));
      editor.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true });
      editor.focus();
    },
    focus() {
      view.current?.focus();
    },
  }));

  return <div className="code" ref={host} data-testid="editor" />;
});

