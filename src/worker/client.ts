import type { CompareOutcome, CompileOutcome, RunOutcome, WorkerRequest, WorkerResponse } from "./protocol";

/** The part of a Worker the client uses; tests pass a fake. */
export interface WorkerLike {
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: WorkerRequest): void;
  terminate(): void;
}

/** A hard stop, in case the interpreter's own limits (5 s of running) do not end a run, for instance while the trace is built. */
export const HARD_TIMEOUT_MS = 12_000;

/** A compiled program has no step counter, so this is its only limit besides Stop (spec S-20). */
export const COMPILED_TIMEOUT_MS = 5_000;

/** How a request ended. `timedOut` says that the hard timeout, not Stop, ended it. */
export type End<T> =
  | { readonly kind: "done"; readonly outcome: T }
  | { readonly kind: "stopped"; readonly timedOut?: true }
  | { readonly kind: "failed"; readonly message: string };

export type RunEnd = End<RunOutcome>;
export type CompileEnd = End<CompileOutcome>;
export type CompareEnd = End<CompareOutcome>;

const createDefaultWorker = (): WorkerLike =>
  new Worker(new URL("./run.worker.ts", import.meta.url), { type: "module" }) as unknown as WorkerLike;

/**
 * Runs programs in a Web Worker, so that the page never freezes (AC-24, AC-25, S-26). Stopping ends the worker and
 * the next request starts a fresh one; nothing from a stopped run can leak into the next. Interpreting, compiling and
 * comparing share all of this: they are three kinds of request to the same kind of worker.
 */
export class RunClient {
  private worker: WorkerLike | null = null;
  private nextId = 1;
  private pending: { id: number; finish: (end: End<never>) => void; timer: ReturnType<typeof setTimeout> } | null = null;

  constructor(
    private readonly createWorker: () => WorkerLike = createDefaultWorker,
    private readonly timeoutMs: number = HARD_TIMEOUT_MS,
    private readonly compiledTimeoutMs: number = COMPILED_TIMEOUT_MS,
  ) {}

  get running(): boolean {
    return this.pending !== null;
  }

  run(source: string): Promise<RunEnd> {
    return this.send({ type: "run", source }, this.timeoutMs, "result");
  }

  /** Compiles and runs the module. A compiled program that never ends is cut after `compiledTimeoutMs`. */
  compile(source: string): Promise<CompileEnd> {
    return this.send({ type: "compile", source }, Math.min(this.timeoutMs, this.compiledTimeoutMs), "compiled");
  }

  /** Interprets and compiles the same program, and compares them. */
  compare(source: string): Promise<CompareEnd> {
    return this.send({ type: "compare", source }, this.timeoutMs, "compared");
  }

  private send<T>(request: { type: WorkerRequest["type"]; source: string }, timeoutMs: number, answer: WorkerResponse["type"]): Promise<End<T>> {
    this.stop();
    const worker = this.createWorker();
    this.worker = worker;
    const id = this.nextId++;
    return new Promise<End<T>>((resolve) => {
      const finish = (end: End<T>): void => {
        if (this.pending?.id !== id) return;
        clearTimeout(this.pending.timer);
        this.pending = null;
        resolve(end);
      };
      const timer = setTimeout(() => {
        this.discardWorker();
        finish({ kind: "stopped", timedOut: true });
      }, timeoutMs);
      this.pending = { id, finish: finish as (end: End<never>) => void, timer };
      worker.onmessage = (event) => {
        if (event.data.type === answer && event.data.id === id) finish({ kind: "done", outcome: event.data.outcome as T });
      };
      worker.onerror = (event) => {
        this.discardWorker();
        finish({ kind: "failed", message: event.message || "the worker failed" });
      };
      worker.postMessage({ ...request, id } as WorkerRequest);
    });
  }

  /** Ends the current request, if any. Its promise resolves as `stopped`. */
  stop(): void {
    const pending = this.pending;
    this.discardWorker();
    pending?.finish({ kind: "stopped" });
  }

  private discardWorker(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}
