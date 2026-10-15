import { describe, expect, it, vi } from "vitest";
import { run } from "../../src/core/run";
import { RunClient, type WorkerLike } from "../../src/worker/client";
import { handleRequest } from "../../src/worker/handler";
import type { WorkerRequest, WorkerResponse } from "../../src/worker/protocol";

class FakeWorker implements WorkerLike {
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;
  requests: WorkerRequest[] = [];
  postMessage(message: WorkerRequest): void {
    this.requests.push(message);
  }
  terminate(): void {
    this.terminated = true;
  }
  reply(response: WorkerResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<WorkerResponse>);
  }
}

function clientWith(timeoutMs?: number) {
  const workers: FakeWorker[] = [];
  const client = new RunClient(() => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker;
  }, timeoutMs);
  return { client, workers };
}

describe("the worker's handler", () => {
  it("answers with the run and the series for the timeline", () => {
    const response = handleRequest({ type: "run", id: 7, source: "int x = 1; x = 2;" });
    expect(response.type).toBe("result");
    expect(response.id).toBe(7);
    expect(response.outcome.result.stdout).toBe("");
    expect(response.outcome.series.map((s) => s.name)).toEqual(["x"]);
  });

  it("has no series when the program did not run", () => {
    expect(handleRequest({ type: "run", id: 1, source: "int x = ;" }).outcome.series).toEqual([]);
  });

  it("returns exactly what run() returns", () => {
    const source = 'System.out.println("a");';
    expect(handleRequest({ type: "run", id: 1, source }).outcome.result).toEqual(run(source));
  });
});

describe("the run client", () => {
  it("sends the source and resolves with the worker's answer", async () => {
    const { client, workers } = clientWith();
    const promise = client.run("int x;");
    expect(client.running).toBe(true);
    const worker = workers[0] as FakeWorker;
    expect(worker.requests).toEqual([{ type: "run", id: 1, source: "int x;" }]);
    worker.reply(handleRequest(worker.requests[0] as WorkerRequest));
    const end = await promise;
    expect(end.kind).toBe("done");
    expect(client.running).toBe(false);
  });

  it("stops: terminates the worker and resolves as stopped", async () => {
    const { client, workers } = clientWith();
    const promise = client.run("while (true) { }");
    client.stop();
    expect(await promise).toEqual({ kind: "stopped" });
    expect((workers[0] as FakeWorker).terminated).toBe(true);
    expect(client.running).toBe(false);
  });

  it("uses a fresh worker for the next run and ignores answers from the old one", async () => {
    const { client, workers } = clientWith();
    const first = client.run("a");
    const second = client.run("b");
    expect(await first).toEqual({ kind: "stopped" });
    expect(workers).toHaveLength(2);
    expect((workers[0] as FakeWorker).terminated).toBe(true);
    (workers[0] as FakeWorker).reply(handleRequest({ type: "run", id: 1, source: "int stale;" }));
    const live = workers[1] as FakeWorker;
    live.reply(handleRequest(live.requests[0] as WorkerRequest));
    const end = await second;
    expect(end.kind).toBe("done");
    if (end.kind === "done") expect(end.outcome.result.symbols).toEqual([]);
  });

  it("gives up after the hard timeout", async () => {
    vi.useFakeTimers();
    try {
      const { client, workers } = clientWith(1000);
      const promise = client.run("anything");
      await vi.advanceTimersByTimeAsync(1001);
      expect(await promise).toEqual({ kind: "stopped" });
      expect((workers[0] as FakeWorker).terminated).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports a worker that fails", async () => {
    const { client, workers } = clientWith();
    const promise = client.run("x");
    (workers[0] as FakeWorker).onerror?.({ message: "boom" } as ErrorEvent);
    expect(await promise).toEqual({ kind: "failed", message: "boom" });
  });

  it("does nothing when stopped with nothing running", () => {
    const { client } = clientWith();
    expect(() => client.stop()).not.toThrow();
  });
});
