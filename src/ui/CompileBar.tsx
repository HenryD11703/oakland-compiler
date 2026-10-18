import type { CompareOutcome, CompileOutcome } from "../worker/protocol";

const NUMBER = new Intl.NumberFormat("en-US");
const ms = (n: number): string => (n >= 100 ? NUMBER.format(Math.round(n)) : n >= 10 ? n.toFixed(0) : n.toFixed(1)) + " ms";
const ticks = [
  [0.1, "0.1 ms"],
  [1, "1 ms"],
  [10, "10 ms"],
  [100, "100 ms"],
  [1000, "1 s"],
  [10000, "10 s"],
] as const;
/** Each step of the scale is ten times more, from a tenth of a millisecond to ten seconds. */
const place = (value: number): number => Math.min(100, Math.max(1, ((Math.log10(Math.max(value, 0.1)) + 1) / 5) * 100));

/** The numbers of the module where the timeline is in Interpret mode, and the way to Compare. */
export function Ledger({ outcome, stale, busy, onCompare }: { outcome: CompileOutcome | null; stale: boolean; busy: boolean; onCompare: () => void }) {
  return (
    <footer className="compilebar ledger" aria-label="The compiled module">
      <div>
        <div className="label">Module</div>
        <div className="big" data-testid="module-bytes">
          {outcome?.ok ? NUMBER.format(outcome.bytes) : "—"} <small>bytes</small>
        </div>
      </div>
      <div>
        <div className="label">Compile</div>
        <div className="big">{outcome ? ms(outcome.compileMs).replace(" ms", "") : "—"} <small>ms</small></div>
      </div>
      <div>
        <div className="label">Run</div>
        <div className="big">{outcome?.runMs != null ? ms(outcome.runMs).replace(" ms", "") : "—"} <small>ms</small></div>
      </div>
      <div className="why">
        <div className="label">Timeline</div>
        <div className="note">Not in Compile mode: a compiled program runs to the end without recording steps.{stale ? " The source changed since this was compiled." : ""}</div>
      </div>
      <button type="button" className="compare" onClick={onCompare} disabled={busy}>
        Compare ⇄
      </button>
    </footer>
  );
}

/** Both modes on one program: two bars on a scale where each step is ten times more, the ratio, and whether the outputs agree. */
export function CompareBars({ comparison, onClose }: { comparison: CompareOutcome; onClose: () => void }) {
  const slow = comparison.interpreted.ms;
  const fast = comparison.compiled.runMs ?? 0;
  const ratio = fast > 0 ? Math.round(slow / fast) : null;
  return (
    <footer className="compilebar chart" aria-label="Interpret and Compile compared" data-testid="compare">
      <div className="rows">
        <span className="label">Interpret</span>
        <span className="track" aria-hidden="true">
          <span className="fill" style={{ width: `${place(slow)}%` }} />
        </span>
        <span className="val">{ms(slow)}</span>
        <span className="label">Compile</span>
        <span className="track" aria-hidden="true">
          <span className="fill fast" style={{ width: `${place(fast)}%` }} />
        </span>
        <span className="val">{ms(fast)}</span>
        <span />
        <span className="axis" aria-hidden="true">
          {ticks.map(([, label]) => (
            <span key={label}>{label}</span>
          ))}
        </span>
        <span />
        <div className="foot">
          {comparison.outputs === "identical" ? <span className="same">✓ the outputs are identical</span> : null}
          {comparison.outputs === "different" ? <span className="differ">✗ the outputs differ: this is a bug of the compiler, please report it</span> : null}
          {comparison.outputs === "not comparable" ? <span className="note">The outputs cannot be compared: {comparison.note}.</span> : null}
          <span className="note">Scale: each step is ten times more. One run of each, interpreted without the trace; compiling took {ms(comparison.compiled.compileMs)}.</span>
          <button type="button" className="mini" onClick={onClose}>
            Close ✕
          </button>
        </div>
      </div>
      <div className="ratio" aria-label={ratio === null ? "no ratio" : `${ratio} times faster compiled`}>
        {ratio === null ? "—" : `${NUMBER.format(ratio)}×`}
        <small>{ratio === null ? "" : "faster"}</small>
      </div>
    </footer>
  );
}
