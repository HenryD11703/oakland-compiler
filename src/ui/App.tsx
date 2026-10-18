import { lazy, Suspense, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { parse } from "../core/parser/parser";
import { renderValue, TraceReplayer } from "../core/trace/replay";
import { DEFAULT_EXAMPLE, EXAMPLES } from "../examples";
import { RunClient } from "../worker/client";
import type { CompareOutcome, CompileOutcome, RunOutcome } from "../worker/protocol";
import { CompareBars, Ledger } from "./CompileBar";
import { CompiledPanel } from "./CompiledPanel";
import type { EditorHandle, InlineEntry } from "./Editor";
import { assignedNames } from "./inlineValues";
import { DEFAULT_LAYOUT, loadLayout, saveLayout, type Layout } from "./layout";
import { count, OutputView, ProblemsList, SymbolsTable, VariablesTable } from "./Panels";
import { SyntaxTree } from "./SyntaxTree";
import { Splitter } from "./Splitter";
import { Timeline } from "./Timeline";

type Tab = "out" | "problems" | "tree" | "symbols";
const VIEWS: readonly (readonly [Tab, string])[] = [
  ["out", "Output"],
  ["problems", "Problems"],
  ["tree", "Syntax tree"],
  ["symbols", "Symbols"],
];
type View = "code" | "state" | "views";

/** Steps per second while playing. */
const SPEEDS = [
  { label: "Slow", rate: 4 },
  { label: "Normal", rate: 30 },
  { label: "Fast", rate: 200 },
  { label: "Very fast", rate: 1200 },
] as const;

// The editor (CodeMirror) is the heaviest part of the page; it loads in its own chunk while the rest of the
// interface is already on screen.
const Editor = lazy(() => import("./Editor").then((module) => ({ default: module.Editor })));

const DRAFT_KEY = "oakland:draft";

function loadDraft(): string | null {
  try {
    return window.localStorage.getItem(DRAFT_KEY);
  } catch {
    return null;
  }
}

function saveDraft(text: string): void {
  try {
    window.localStorage.setItem(DRAFT_KEY, text);
  } catch {
    // Storage can be blocked; the draft is only a convenience.
  }
}

export function App() {
  const [initial, setInitial] = useState(() => {
    const draft = loadDraft();
    return draft ? { title: "Your draft", text: draft } : { title: `${DEFAULT_EXAMPLE.title} (example)`, text: DEFAULT_EXAMPLE.source };
  });
  const [client] = useState(() => new RunClient());
  const editor = useRef<EditorHandle>(null);
  const runToken = useRef(0);
  const sourceRef = useRef(initial.text);
  const stepRef = useRef(-1);

  const [source, setSource] = useState(initial.text);
  const [title, setTitle] = useState(initial.title);
  const [outcome, setOutcome] = useState<RunOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [step, setStep] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [tab, setTab] = useState<Tab>("out");
  /** The view that fills the whole page, or null when the usual layout shows. */
  const [full, setFull] = useState<Tab | null>(null);
  const [view, setView] = useState<View>("code");
  const [menu, setMenu] = useState(false);
  const [layout, setLayout] = useState<Layout>(loadLayout);
  /** Interpret watches a run step by step; Compile turns the program into WebAssembly and runs that. */
  const [mode, setMode] = useState<"interpret" | "compile">("interpret");
  const [compiled, setCompiled] = useState<CompileOutcome | null>(null);
  const [compiledStale, setCompiledStale] = useState(false);
  /** Each module the page shows gets a number, so that the panel starts afresh with a new one. */
  const [compiledId, setCompiledId] = useState(0);
  const [comparison, setComparison] = useState<CompareOutcome | null>(null);
  /** Compile mode: is the output-and-problems drawer open? */
  const [drawer, setDrawer] = useState(false);
  const [marked, setMarked] = useState<{ from: number; to: number } | null>(null);
  const [focusFn, setFocusFn] = useState<{ name: string; nonce: number } | null>(null);

  // ---------- panel sizes ----------

  const sheetRef = useRef<HTMLElement>(null);
  const sideRef = useRef<HTMLElement>(null);
  const nowRef = useRef<HTMLElement>(null);
  const varsRef = useRef<HTMLElement>(null);

  const resize = useCallback((part: keyof Layout, size: number | null) => {
    setLayout((before) => {
      const next = { ...before, [part]: size };
      saveLayout(next);
      return next;
    });
  }, []);
  const resizeSide = useCallback((size: number) => resize("side", size), [resize]);
  const resizeVars = useCallback((size: number) => resize("vars", size), [resize]);
  const resetSide = useCallback(() => resize("side", DEFAULT_LAYOUT.side), [resize]);
  const resetVars = useCallback(() => resize("vars", DEFAULT_LAYOUT.vars), [resize]);
  // The code keeps at least 360 px, the views at least 160 px; the dividers are 9 px.
  const maxSide = useCallback(() => (sheetRef.current?.clientWidth ?? 0) - 360 - 9, []);
  const maxVars = useCallback(() => (sideRef.current?.clientHeight ?? 0) - (nowRef.current?.offsetHeight ?? 0) - 160 - 9, []);
  const sheetStyle: CSSProperties & Record<string, string | undefined> = {
    "--side-w": layout.side === null ? undefined : `${layout.side}px`,
    "--vars-h": layout.vars === null ? undefined : `${layout.vars}px`,
  };

  // ---------- running ----------

  const run = useCallback(async () => {
    const token = ++runToken.current;
    const text = sourceRef.current;
    setBusy(true);
    setMessage(null);
    setPlaying(false);
    const end = await client.run(text);
    if (token !== runToken.current) return; // a newer run or a stop took over
    setBusy(false);
    if (end.kind === "done") {
      setOutcome(end.outcome);
      setStale(sourceRef.current !== text);
      const trace = end.outcome.result.trace;
      setStep(trace ? trace.steps.length - 1 : -1);
      if (!end.outcome.result.ran) setTab("problems");
    } else if (end.kind === "stopped") {
      setMessage("The run was stopped.");
    } else {
      setMessage(`The run failed: ${end.message}`);
    }
  }, [client]);

  const compileRun = useCallback(async () => {
    const token = ++runToken.current;
    const text = sourceRef.current;
    setBusy(true);
    setMessage(null);
    setComparison(null);
    setMarked(null);
    const end = await client.compile(text);
    if (token !== runToken.current) return;
    setBusy(false);
    if (end.kind === "done") {
      setCompiled(end.outcome);
      setCompiledId((n) => n + 1);
      setCompiledStale(sourceRef.current !== text);
      if (!end.outcome.ok) setDrawer(true);
    } else if (end.kind === "stopped") {
      setMessage(end.timedOut ? "The compiled program was stopped after 5 seconds: it may never end." : "The run was stopped.");
    } else {
      setMessage(`The run failed: ${end.message}`);
    }
  }, [client]);

  const compareRun = useCallback(async () => {
    const token = ++runToken.current;
    const text = sourceRef.current;
    setBusy(true);
    setMessage(null);
    const end = await client.compare(text);
    if (token !== runToken.current) return;
    setBusy(false);
    if (end.kind === "done") {
      setComparison(end.outcome);
      setCompiled(end.outcome.compiled);
      setCompiledId((n) => n + 1);
      setCompiledStale(sourceRef.current !== text);
    } else if (end.kind === "stopped") {
      setMessage(end.timedOut ? "The comparison was stopped after 12 seconds: a program that never ends cannot be compared." : "The run was stopped.");
    } else {
      setMessage(`The run failed: ${end.message}`);
    }
  }, [client]);

  /** What Run, Ctrl+Enter and loading an example do: the current mode's run. */
  const go = useCallback(() => (mode === "compile" ? compileRun() : run()), [mode, compileRun, run]);

  const switchMode = useCallback(
    (next: "interpret" | "compile") => {
      if (next === mode) return;
      runToken.current++;
      client.stop();
      setBusy(false);
      setMessage(null);
      setFull((before) => (before === "symbols" && next === "compile" ? null : before));
      setMode(next);
    },
    [mode, client],
  );

  const stop = useCallback(() => {
    runToken.current++;
    client.stop();
    setBusy(false);
    setMessage("The run was stopped.");
  }, [client]);

  useEffect(() => {
    // Run the starting program once the page has painted, so that the first thing seen is a finished run.
    const timer = window.setTimeout(() => void run(), 0);
    return () => {
      window.clearTimeout(timer);
      client.stop();
    };
  }, [run, client]);

  useEffect(() => {
    stepRef.current = step;
  }, [step]);

  const onEdit = useCallback((text: string) => {
    sourceRef.current = text;
    setSource(text);
    setStale(true);
    setCompiledStale(true);
    saveDraft(text);
  }, []);

  // ---------- examples and files ----------

  const loadText = useCallback(
    (name: string, text: string) => {
      setTitle(name);
      setMenu(false);
      setView("code");
      // If the editor is still loading, it will start with this text.
      if (editor.current) editor.current.setText(text);
      else setInitial({ title: name, text });
      sourceRef.current = text;
      setSource(text);
      void go();
    },
    [go],
  );

  const fileInput = useRef<HTMLInputElement>(null);
  const openFile = (file: File | undefined): void => {
    if (!file) return;
    void file.text().then((text) => loadText(file.name, text));
  };
  const saveFile = (): void => {
    const url = URL.createObjectURL(new Blob([sourceRef.current], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = /\.(oak|txt)$/.test(title) ? title : "program.oak";
    link.click();
    URL.revokeObjectURL(url);
    setMenu(false);
  };

  useEffect(() => {
    if (full === null) return;
    const close = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setFull(null);
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [full]);

  useEffect(() => {
    if (!menu) return;
    const close = (event: Event): void => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (event instanceof MouseEvent && (event.target as HTMLElement).closest("[data-menu]")) return;
      setMenu(false);
    };
    document.addEventListener("keydown", close);
    document.addEventListener("mousedown", close);
    return () => {
      document.removeEventListener("keydown", close);
      document.removeEventListener("mousedown", close);
    };
  }, [menu]);

  // ---------- what the editor shows ----------

  const deferred = useDeferredValue(source);
  const syntax = useMemo(() => parse(deferred).diagnostics, [deferred]);
  const compileMode = mode === "compile";
  const diagnostics = syntax.length > 0 ? syntax : compileMode ? (compiled && !compiledStale ? [...compiled.diagnostics, ...(compiled.ran?.diagnostics ?? [])] : []) : outcome && !stale ? outcome.result.diagnostics : [];

  const trace = outcome?.result.trace ?? null;
  const steps = trace?.steps.length ?? 0;
  const replayer = useMemo(() => (trace ? new TraceReplayer(trace) : null), [trace]);
  // The run opens on its last step, whose state the worker already computed: no need to replay thirteen thousand steps.
  const finalState = outcome?.finalState ?? null;
  const state = useMemo(
    () => (finalState && step === steps - 1 ? finalState : replayer ? replayer.stateAt(step) : null),
    [replayer, finalState, step, steps],
  );
  const changes = useMemo(() => (replayer && step >= 0 ? replayer.changesAt(step) : null), [replayer, step]);
  const current = trace && step >= 0 ? trace.steps[step] : undefined;
  const showingRun = outcome !== null && !stale;

  const markedSpan = useMemo(
    () => (marked === null ? null : { start: { offset: 0, line: marked.from, column: 1 }, end: { offset: 0, line: marked.to, column: 1 } }),
    [marked],
  );
  const activeSpan = compileMode ? markedSpan : showingRun && current && current.kind !== "end" ? current.span : null;

  const names = useMemo(() => (outcome ? assignedNames(outcome.result.ast) : new Map<number, string[]>()), [outcome]);
  const inline = useMemo<InlineEntry[]>(() => {
    if (compileMode || !showingRun || !state || step < 0) return [];
    const entries: InlineEntry[] = [];
    for (const [line, lineNames] of names) {
      const parts: InlineEntry["parts"][number][] = [];
      for (const name of lineNames) {
        const found = [...state.frames].reverse().flatMap((f) => [...f.scopes].reverse().flatMap((s) => [...s.vars].reverse())).find((v) => v.name === name);
        if (found) parts.push({ name, value: renderValue(state, found.value, found.type, true) });
      }
      if (parts.length > 0) entries.push({ line, parts });
    }
    return entries;
  }, [compileMode, showingRun, state, step, names]);

  // ---------- playback ----------

  const seek = useCallback((next: number) => {
    setPlaying(false);
    setStep(next);
  }, []);

  useEffect(() => {
    if (!playing || steps === 0) return;
    const rate = SPEEDS[speed]?.rate ?? 30;
    let frame = 0;
    let last = performance.now();
    let position = Math.max(stepRef.current, -1) >= steps - 1 ? -1 : stepRef.current;
    const tick = (now: number): void => {
      position += ((now - last) / 1000) * rate;
      last = now;
      const next = Math.min(steps - 1, Math.floor(position));
      setStep(next);
      if (next >= steps - 1) setPlaying(false);
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, speed, steps]);

  // ---------- views ----------

  const reveal = useCallback((span: Parameters<EditorHandle["reveal"]>[0]) => {
    setFull(null);
    setView("code");
    // The code view must be visible before the editor can measure and scroll to the range.
    requestAnimationFrame(() => editor.current?.reveal(span));
  }, []);

  const result = outcome?.result ?? null;
  const stdout = result ? (state && trace ? result.stdout.slice(0, state.outputLength) : result.stdout) : "";
  const totalLines = result && result.stdout !== "" ? result.stdout.replace(/\n$/, "").split("\n").length : 0;
  const lineCount = source.split("\n").length;
  const viewStdout = compileMode ? (compiled?.ran?.stdout ?? "") : stdout;
  const viewTotal = compileMode ? (viewStdout === "" ? 0 : viewStdout.replace(/\n$/, "").split("\n").length) : totalLines;
  const viewRan = compileMode ? (compiled ? compiled.ok : true) : result ? result.ran || syntax.length === 0 : true;
  const viewAst = compileMode ? (compiled?.ast ?? null) : (result?.ast ?? null);
  const viewSymbols = compileMode ? [] : (result?.symbols ?? []);
  const viewIds = compileMode ? VIEWS.filter(([id]) => id !== "symbols") : VIEWS;
  const staleNow = compileMode ? compiledStale : stale;

  /** The source cursor is in a function of the program: its WebAssembly opens (Compile mode). */
  const onCursorLine = useCallback(
    (line: number) => {
      if (!compileMode || !compiled) return;
      const inside = compiled.functions.filter((f) => f.source !== null && f.source.from <= line && line <= f.source.to);
      const narrowest = inside.sort((x, y) => (x.source!.to - x.source!.from) - (y.source!.to - y.source!.from))[0];
      if (narrowest) setFocusFn((before) => ({ name: narrowest.name, nonce: (before?.nonce ?? 0) + 1 }));
    },
    [compileMode, compiled],
  );
  const jumpToSource = useCallback((from: number, to: number) => {
    setMarked({ from, to });
    // The lines from..to as a range of the text, so that the editor selects exactly them.
    const lines = sourceRef.current.split("\n");
    const start = lines.slice(0, from - 1).reduce((offset, line) => offset + line.length + 1, 0);
    const end = lines.slice(0, to).reduce((offset, line) => offset + line.length + 1, 0) - 1;
    const span = { start: { offset: start, line: from, column: 1 }, end: { offset: Math.max(start, end), line: to, column: 1 } };
    setView("code");
    requestAnimationFrame(() => editor.current?.reveal(span));
  }, []);

  /** Output, Problems, Syntax tree and Symbols: beside the variables in Interpret mode, in the drawer in Compile mode. */
  const viewsPanel = (
    <>
      <div className="tabrow">
        <div role="tablist" className="tabs" aria-label="Views">
          {viewIds.map(([id, label]) => (
            <button key={id} type="button" role="tab" id={`tab-${id}`} aria-selected={tab === id} aria-controls={`pane-${id}`} onClick={() => setTab(id)}>
              {label}
              {id === "problems" && diagnostics.length > 0 ? <span className="badge">{diagnostics.length}</span> : null}
            </button>
          ))}
        </div>
        <button type="button" className="expand" onClick={() => setFull(tab)}>
          Full view ⤢
        </button>
      </div>
      <div role="tabpanel" id="pane-out" aria-labelledby="tab-out" hidden={tab !== "out"} tabIndex={0}>
        <OutputView text={viewStdout} total={viewTotal} ran={viewRan} />
      </div>
      <div role="tabpanel" id="pane-problems" aria-labelledby="tab-problems" hidden={tab !== "problems"} tabIndex={0}>
        <ProblemsList diagnostics={diagnostics} onPick={reveal} />
      </div>
      <div role="tabpanel" id="pane-tree" aria-labelledby="tab-tree" hidden={tab !== "tree"} tabIndex={0}>
        <SyntaxTree ast={viewAst} onReveal={reveal} />
      </div>
      {compileMode ? null : (
        <div role="tabpanel" id="pane-symbols" aria-labelledby="tab-symbols" hidden={tab !== "symbols"} tabIndex={0}>
          <SymbolsTable symbols={viewSymbols} onPick={reveal} />
        </div>
      )}
    </>
  );

  const readout =
    trace && step >= 0
      ? `Step ${count(step + 1)} of ${count(steps)}`
      : trace
        ? `Start, before step 1 of ${count(steps)}`
        : "No run yet";
  const where = current && current.kind !== "end" ? `line ${current.span.start.line}${current.note ? `, ${current.note}` : ""}` : current ? "finished" : "";
  const valueText = `${readout}${where ? `, ${where}` : ""}`;

  return (
    <div className="app" data-full={full ?? undefined}>
      <header className="top">
        <h1 className="brand">
          Oak<span>Land</span>
        </h1>
        <nav className="menu" aria-label="Program" data-menu>
          <button type="button" className="link-button" aria-expanded={menu} aria-controls="examples-menu" onClick={() => setMenu(!menu)}>
            Examples ▾
          </button>
          <div className="seg" role="group" aria-label="Mode">
            <button type="button" aria-pressed={!compileMode} onClick={() => switchMode("interpret")}>
              Interpret
            </button>
            <button type="button" aria-pressed={compileMode} onClick={() => switchMode("compile")}>
              Compile
            </button>
          </div>
          <div className="whole-views" role="group" aria-label="Whole views">
            {viewIds.map(([id, label]) => (
              <button key={id} type="button" aria-pressed={full === id} onClick={() => setFull(full === id ? null : id)}>
                {label}
                {id === "problems" && diagnostics.length > 0 ? <span className="badge">{diagnostics.length}</span> : null}
              </button>
            ))}
          </div>
          <span className="file" title={title}>
            {title}
          </span>
        </nav>
        <div className="actions">
          <button type="button" className="stop" onClick={stop} disabled={!busy}>
            Stop
          </button>
          <button type="button" className="run" onClick={() => void go()} disabled={busy}>
            {busy ? (compileMode ? "Compiling…" : "Running…") : compileMode ? "Compile ▸" : "Run ▸"}
          </button>
        </div>
        {menu ? (
          <div className="popover" id="examples-menu" data-menu>
            <ul>
              {EXAMPLES.map((example) => (
                <li key={example.id}>
                  <button type="button" onClick={() => loadText(`${example.title} (example)`, example.source)}>
                    <span className="t">{example.title}</span>
                    <br />
                    <span className="d">{example.blurb}</span>
                  </button>
                </li>
              ))}
              <li className="rule">
                <button type="button" onClick={() => fileInput.current?.click()}>
                  <span className="t">Open a file…</span>
                  <br />
                  <span className="d">A .oak or .txt program from your computer.</span>
                </button>
              </li>
              <li>
                <button type="button" onClick={saveFile}>
                  <span className="t">Save as .oak</span>
                  <br />
                  <span className="d">Download what is in the editor.</span>
                </button>
              </li>
            </ul>
          </div>
        ) : null}
        <input ref={fileInput} type="file" accept=".oak,.txt,text/plain" hidden onChange={(event) => { openFile(event.target.files?.[0]); event.target.value = ""; }} />
      </header>

      {message || staleNow ? (
        <div className="notice" role="status">
          {staleNow && !message ? (
            <>
              <strong>Edited since the last {compileMode ? "compile" : "run"}.</strong> Press {compileMode ? "Compile" : "Run"} (Ctrl+Enter) to update the {compileMode ? "WebAssembly and the output" : "output and the timeline"}.
            </>
          ) : (
            message
          )}
        </div>
      ) : null}

      <nav aria-label="Panels" className="mtabs-nav">
        <div className="mtabs" role="tablist" aria-label="Panel">
          {(["code", "state", "views"] as const).map((name) => (
            <button key={name} type="button" role="tab" aria-selected={view === name} onClick={() => setView(name)}>
              {name === "code" ? "Code" : name === "state" ? (compileMode ? "WebAssembly" : "State") : compileMode ? "Results" : "Views"}
            </button>
          ))}
        </div>
      </nav>

      {full !== null ? (
        <main className="fullview" aria-label={`${VIEWS.find(([id]) => id === full)?.[1] ?? ""}, whole view`}>
          <div className="fullbar">
            <h2>{VIEWS.find(([id]) => id === full)?.[1]}</h2>
            <button type="button" onClick={() => setFull(null)}>
              Close ✕
            </button>
          </div>
          <div className="fullbody">
            {full === "out" ? <OutputView text={viewStdout} total={viewTotal} ran={viewRan} /> : null}
            {full === "problems" ? <ProblemsList diagnostics={diagnostics} onPick={reveal} /> : null}
            {full === "tree" ? <SyntaxTree ast={viewAst} onReveal={reveal} whole /> : null}
            {full === "symbols" ? <SymbolsTable symbols={viewSymbols} onPick={reveal} /> : null}
          </div>
        </main>
      ) : null}

      <main className="sheet" data-view={view} data-mode={mode} ref={sheetRef} style={sheetStyle}>
        <Suspense
          fallback={
            <div className="code">
              <pre className="code-fallback">{initial.text}</pre>
            </div>
          }
        >
          <Editor ref={editor} initialText={initial.text} onChange={onEdit} onRun={() => void go()} onCursorLine={onCursorLine} diagnostics={diagnostics} activeSpan={activeSpan} inline={inline} />
        </Suspense>

        <Splitter orientation="vertical" target={sideRef} label="Resize the code and the side panels" min={320} max={maxSide} grow={-1} onResize={resizeSide} onReset={resetSide} />

        {compileMode ? (
        <aside className="side wasm-side" ref={sideRef}>
          <section className="wasm-panel" aria-label="Compiled" tabIndex={0}>
            <CompiledPanel key={compiledId} outcome={compiled} busy={busy} focus={focusFn} onJump={jumpToSource} />
          </section>
          <section className="results" aria-label="Output and problems">
            <button type="button" className="under" aria-expanded={drawer || view === "views"} onClick={() => setDrawer(!drawer)}>
              <span>
                <span className="k">Output</span> <span className="mono" data-testid="under-output">{viewStdout === "" ? (compiled ? "nothing printed" : "—") : viewStdout.trim().split("\n")[0]}</span>
                {viewTotal > 1 ? <span className="dim"> · {count(viewTotal)} lines</span> : null}
              </span>
              <span>
                <span className="k">Problems</span> <span className="mono">{diagnostics.length === 0 ? "none" : diagnostics.length}</span>
              </span>
              <span className="grow dim">{drawer || view === "views" ? "Close ▾" : "Open ▴"}</span>
            </button>
            {drawer || view === "views" ? <section className="block views" aria-label="Views">{viewsPanel}</section> : null}
          </section>
        </aside>
        ) : (
          <aside className="side" ref={sideRef}>
            <section className="block now" aria-label="Current step" ref={nowRef}>
              <div className="label">Now</div>
              <div className="big" data-testid="readout">
                {trace && step >= 0 ? (
                  <>
                    Step {count(step + 1)} <small>of {count(steps)}</small>
                  </>
                ) : (
                  <>{trace ? "Start" : "—"}</>
                )}
              </div>
              <div className="what">
                {!showingRun ? (
                  <span className="hint">{outcome ? "The source changed: this is the last run." : busy ? "Running…" : "Press Run."}</span>
                ) : current && current.kind === "end" ? (
                  <b>Program finished</b>
                ) : current ? (
                  <>
                    Line {current.span.start.line} ·{" "}
                    {current.kind === "condition" ? (
                      <>
                        condition <b>{current.note}</b>
                      </>
                    ) : current.kind === "return" ? (
                      <>
                        back from a call{current.note ? <>, <b>{current.note.replace("returned ", "")}</b></> : null}
                      </>
                    ) : current.kind === "iteration" ? (
                      "next element"
                    ) : (
                      "statement ran"
                    )}
                  </>
                ) : (
                  <span className="hint">Before the first step.</span>
                )}
              </div>
              <div className="progress">
                <i style={{ width: steps > 1 && step >= 0 ? `${(step / (steps - 1)) * 100}%` : "0%" }} />
              </div>
            </section>

            <section className="block vars" aria-label="Variables" tabIndex={0} ref={varsRef}>
              <div className="label">Variables</div>
              <VariablesTable state={showingRun ? state : null} changes={changes} />
            </section>

            <Splitter orientation="horizontal" target={varsRef} label="Resize the variables and the views" min={72} max={maxVars} grow={1} onResize={resizeVars} onReset={resetVars} />

            <section className="block views" aria-label="Views">
              {viewsPanel}
            </section>
          </aside>
        )}
      </main>

      {compileMode ? (
        comparison ? (
          <CompareBars comparison={comparison} onClose={() => setComparison(null)} />
        ) : (
          <Ledger outcome={compiled} stale={compiledStale} busy={busy} onCompare={() => void compareRun()} />
        )
      ) : (
        <footer className="tape" aria-label="Step through the run">
          <div className="deck">
            <button type="button" aria-label="Back to the start" onClick={() => seek(-1)} disabled={!trace}>
              |◂
            </button>
            <button type="button" aria-label="Back one step" onClick={() => seek(Math.max(-1, step - 1))} disabled={!trace}>
              ◂
            </button>
            <button type="button" className="play" onClick={() => setPlaying(!playing)} disabled={!trace}>
              {playing ? "Pause" : "Play"}
            </button>
            <button type="button" aria-label="Forward one step" onClick={() => seek(Math.min(steps - 1, step + 1))} disabled={!trace}>
              ▸
            </button>
            <label>
              Speed
              <select value={speed} onChange={(event) => setSpeed(Number(event.target.value))} disabled={!trace}>
                {SPEEDS.map((s, i) => (
                  <option key={s.label} value={i}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="readout" aria-live="off">
              {trace ? (
                <>
                  {step >= 0 ? count(step + 1) : "0"} / {count(steps)}
                  {trace.truncated ? <small> · trace cut at {count(steps)} steps</small> : null}
                </>
              ) : (
                "—"
              )}
            </div>
          </div>
          {trace && result ? (
            <Timeline trace={trace} series={outcome?.series ?? []} lineCount={lineCount} totalOutput={result.stdout.length} step={step} onSeek={seek} valueText={valueText} />
          ) : (
            <div className="lane-empty">{busy ? "Running…" : "The timeline appears here after a run."}</div>
          )}
        </footer>
      )}
    </div>
  );
}
