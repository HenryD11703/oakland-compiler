import type { RunResult } from "../core/run";
import type { ReplayState } from "../core/trace/replay";
import type { Series } from "../core/trace/series";

/** What the page asks the worker to do. One run at a time; the id tells the answer which run it belongs to. */
export interface WorkerRequest {
  readonly type: "run";
  readonly id: number;
  readonly source: string;
}

/** Everything the interface needs after a run, as plain data. */
export interface RunOutcome {
  readonly result: RunResult;
  /** The numeric variables that change most, one value per trace step, for the timeline lanes. */
  readonly series: Series[];
  /** The state after the last step, computed here so that the page does not replay the whole trace to show it. */
  readonly finalState: ReplayState | null;
}

export interface WorkerResponse {
  readonly type: "result";
  readonly id: number;
  readonly outcome: RunOutcome;
}
