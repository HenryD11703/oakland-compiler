import type { RunOutcome, WorkerRequest, WorkerResponse } from "./protocol";

/** The part of a Worker the client uses; tests pass a fake. */
export interface WorkerLike {
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: WorkerRequest): void;
  terminate(): void;
}

/** A hard stop, in case the interpreter's own limits (5 s of running) do not end a run, for instance while the trace is built. */
export const HARD_TIMEOUT_MS = 12_000;

export type RunEnd =
  | { readonly kind: "done"; readonly outcome: RunOutcome }
  | { readonly kind: "stopped" }
  | { readonly kind: "failed"; readonly message: string };

const createDefaultWorker = (): WorkerLike =>
  new Worker(new URL("./run.worker.ts", import.meta.url), { type: "module" }) as unknown as WorkerLike;

/**
 * Runs programs in a Web Worker, so that the page never freezes (AC-24, AC-25). Stopping ends the worker and
 * the next run starts a fresh one; nothing from a stopped run can leak into the next.
 */
export class RunClient {
  private worker: WorkerLike | null = null;
  private nextId = 1;
  private pending: { id: number; finish: (end: RunEnd) => void; timer: ReturnType<typeof setTimeout> } | null = null;

  constructor(
    private readonly createWorker: () => WorkerLike = createDefaultWorker,
    private readonly timeoutMs: number = HARD_TIMEOUT_MS,
  ) {}

  get running(): boolean {
    return this.pending !== null;
  }

  run(source: string): Promise<RunEnd> {
    this.stop();
    const worker = this.createWorker();
    this.worker = worker;
    const id = this.nextId++;
    return new Promise<RunEnd>((resolve) => {
      const finish = (end: RunEnd): void => {
        if (this.pending?.id !== id) return;
        clearTimeout(this.pending.timer);
        this.pending = null;
        resolve(end);
      };
      const timer = setTimeout(() => {
        this.discardWorker();
        finish({ kind: "stopped" });
      }, this.timeoutMs);
      this.pending = { id, finish, timer };
      worker.onmessage = (event) => {
        if (event.data.type === "result" && event.data.id === id) finish({ kind: "done", outcome: event.data.outcome });
      };
      worker.onerror = (event) => {
        this.discardWorker();
        finish({ kind: "failed", message: event.message || "the worker failed" });
      };
      worker.postMessage({ type: "run", id, source });
    });
  }

  /** Ends the current run, if any. Its promise resolves as `stopped`. */
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
