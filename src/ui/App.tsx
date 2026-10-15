import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { parse } from "../core/parser/parser";
import { renderValue, TraceReplayer } from "../core/trace/replay";
import { DEFAULT_EXAMPLE, EXAMPLES } from "../examples";
import { RunClient } from "../worker/client";
import type { RunOutcome } from "../worker/protocol";
import { Editor, type EditorHandle, type InlineEntry } from "./Editor";
import { assignedNames } from "./inlineValues";
import { AstTree, count, OutputView, ProblemsList, SymbolsTable, VariablesTable } from "./Panels";
import { Timeline } from "./Timeline";

type Tab = "out" | "problems" | "tree" | "symbols";
type View = "code" | "state" | "views";

/** Steps per second while playing. */
const SPEEDS = [
  { label: "Slow", rate: 4 },
  { label: "Normal", rate: 30 },
  { label: "Fast", rate: 200 },
  { label: "Very fast", rate: 1200 },
] as const;

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
  const [initial] = useState(() => {
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
  const [view, setView] = useState<View>("code");
  const [menu, setMenu] = useState(false);

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
    saveDraft(text);
  }, []);

  // ---------- examples and files ----------

  const loadText = useCallback(
    (name: string, text: string) => {
      setTitle(name);
      setMenu(false);
      setView("code");
      editor.current?.setText(text);
      sourceRef.current = text;
      void run();
    },
    [run],
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
  const diagnostics = syntax.length > 0 ? syntax : outcome && !stale ? outcome.result.diagnostics : [];

  const trace = outcome?.result.trace ?? null;
  const steps = trace?.steps.length ?? 0;
  const replayer = useMemo(() => (trace ? new TraceReplayer(trace) : null), [trace]);
  const state = useMemo(() => (replayer ? replayer.stateAt(step) : null), [replayer, step]);
  const changes = useMemo(() => (replayer && step >= 0 ? replayer.changesAt(step) : null), [replayer, step]);
  const current = trace && step >= 0 ? trace.steps[step] : undefined;
  const showingRun = outcome !== null && !stale;

  const activeSpan = showingRun && current && current.kind !== "end" ? current.span : null;

  const names = useMemo(() => (outcome ? assignedNames(outcome.result.ast) : new Map<number, string[]>()), [outcome]);
  const inline = useMemo<InlineEntry[]>(() => {
    if (!showingRun || !state || step < 0) return [];
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
  }, [showingRun, state, step, names]);

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
    setView("code");
    // The code view must be visible before the editor can measure and scroll to the range.
    requestAnimationFrame(() => editor.current?.reveal(span));
  }, []);

  const result = outcome?.result ?? null;
  const stdout = result ? (state && trace ? result.stdout.slice(0, state.outputLength) : result.stdout) : "";
  const totalLines = result && result.stdout !== "" ? result.stdout.replace(/\n$/, "").split("\n").length : 0;
  const lineCount = source.split("\n").length;

  const readout =
    trace && step >= 0
      ? `Step ${count(step + 1)} of ${count(steps)}`
      : trace
        ? `Start, before step 1 of ${count(steps)}`
        : "No run yet";
  const where = current && current.kind !== "end" ? `line ${current.span.start.line}${current.note ? `, ${current.note}` : ""}` : current ? "finished" : "";
  const valueText = `${readout}${where ? `, ${where}` : ""}`;

  return (
    <div className="app">
      <header className="top">
        <h1 className="brand">
          Oak<span>Land</span>
        </h1>
        <nav className="menu" aria-label="Program" data-menu>
          <button type="button" className="link-button" aria-expanded={menu} aria-controls="examples-menu" onClick={() => setMenu(!menu)}>
            Examples ▾
          </button>
          <span className="file" title={title}>
            {title}
          </span>
        </nav>
        <div className="actions">
          <button type="button" className="stop" onClick={stop} disabled={!busy}>
            Stop
          </button>
          <button type="button" className="run" onClick={() => void run()} disabled={busy}>
            {busy ? "Running…" : "Run ▸"}
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

      {message || stale ? (
        <div className="notice" role="status">
          {stale && !message ? (
            <>
              <strong>Edited since the last run.</strong> Press Run (Ctrl+Enter) to update the output and the timeline.
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
              {name === "code" ? "Code" : name === "state" ? "State" : "Views"}
            </button>
          ))}
        </div>
      </nav>

      <main className="sheet" data-view={view}>
        <Editor ref={editor} initialText={initial.text} onChange={onEdit} onRun={() => void run()} diagnostics={diagnostics} activeSpan={activeSpan} inline={inline} />

        <aside className="side">
          <section className="block now" aria-label="Current step">
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

          <section className="block vars" aria-label="Variables" tabIndex={0}>
            <div className="label">Variables</div>
            <VariablesTable state={showingRun ? state : null} changes={changes} />
          </section>

          <section className="block views" aria-label="Views">
            <div role="tablist" className="tabs" aria-label="Views">
              {(
                [
                  ["out", "Output"],
                  ["problems", "Problems"],
                  ["tree", "Syntax tree"],
                  ["symbols", "Symbols"],
                ] as const
              ).map(([id, label]) => (
                <button key={id} type="button" role="tab" id={`tab-${id}`} aria-selected={tab === id} aria-controls={`pane-${id}`} onClick={() => setTab(id)}>
                  {label}
                  {id === "problems" && diagnostics.length > 0 ? <span className="badge">{diagnostics.length}</span> : null}
                </button>
              ))}
            </div>
            <div role="tabpanel" id="pane-out" aria-labelledby="tab-out" hidden={tab !== "out"}>
              <OutputView text={stdout} total={totalLines} ran={result ? result.ran || syntax.length === 0 : true} />
            </div>
            <div role="tabpanel" id="pane-problems" aria-labelledby="tab-problems" hidden={tab !== "problems"}>
              <ProblemsList diagnostics={diagnostics} onPick={reveal} />
            </div>
            <div role="tabpanel" id="pane-tree" aria-labelledby="tab-tree" hidden={tab !== "tree"}>
              <AstTree ast={result?.ast ?? null} onPick={reveal} />
            </div>
            <div role="tabpanel" id="pane-symbols" aria-labelledby="tab-symbols" hidden={tab !== "symbols"}>
              <SymbolsTable symbols={result?.symbols ?? []} onPick={reveal} />
            </div>
          </section>
        </aside>
      </main>

      <footer className="tape" aria-label="Step through the run">
        <div className="deck">
          <button type="button" aria-label="Back to the start" onClick={() => seek(-1)} disabled={!trace}>
            ⏮
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
    </div>
  );
}
