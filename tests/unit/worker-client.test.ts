import { describe, expect, it, vi } from "vitest";
import { run } from "../../src/core/run";
import { TraceReplayer } from "../../src/core/trace/replay";
import type { Trace } from "../../src/core/trace/types";
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

  it("sends the state after the last step, the same one replaying the trace gives", () => {
    const { outcome } = handleRequest({ type: "run", id: 1, source: "int x = 1; int[] a = {1, 2}; a[0] = 9; x = 3;" });
    const trace = outcome.result.trace as Trace;
    const replayed = new TraceReplayer(trace).stateAt(trace.steps.length - 1);
    expect(outcome.finalState).toEqual(replayed);
  });

  it("has no final state when the program did not run", () => {
    expect(handleRequest({ type: "run", id: 1, source: "int x = ;" }).outcome.finalState).toBeNull();
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
      expect(await promise).toEqual({ kind: "stopped", timedOut: true });
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

describe("the worker's handler: compile and compare", () => {
  const SIEVE = "int n = 100;\nboolean[] c = new boolean[n + 1];\nint count = 0;\nfor (int i = 2; i <= n; i++) {\n  if (!c[i]) { count++; for (int j = i * 2; j <= n; j += i) { c[j] = true; } }\n}\nSystem.out.println(count);";

  it("compiles and runs, and answers with the module's functions and their times", () => {
    const response = handleRequest({ type: "compile", id: 3, source: SIEVE });
    expect(response.type).toBe("compiled");
    expect(response.id).toBe(3);
    const { outcome } = response;
    expect(outcome.ok).toBe(true);
    expect(outcome.ran?.stdout).toBe("25\n");
    expect(outcome.bytes).toBeGreaterThan(100);
    expect(outcome.compileMs).toBeGreaterThanOrEqual(0);
    expect(outcome.runMs).toBeGreaterThanOrEqual(0);
    expect(outcome.ast?.kind).toBe("Program");
    expect(outcome.functions[0]).toMatchObject({ name: "main", origin: "yours", source: { from: 1, to: 7 } });
    expect(outcome.functions.filter((f) => f.origin === "runtime").every((f) => f.name.startsWith("rt:") && f.source === null)).toBe(true);
    expect(outcome.functions.map((f) => f.lines.length).reduce((a, b) => a + b, 0)).toBeGreaterThan(40);
  });

  it("maps a function, a method and a constructor of the program to their lines", () => {
    const source = "int twice(int x) {\n  return x * 2;\n}\nclass A {\n  int v;\n  A(int v) { this.v = v; }\n  int get() {\n    return v;\n  }\n}\nSystem.out.println(twice(new A(4).get()));";
    const { outcome } = handleRequest({ type: "compile", id: 1, source });
    const mapped = Object.fromEntries(outcome.functions.map((f) => [f.name, f.source]));
    expect(mapped["twice"]).toEqual({ from: 1, to: 3 });
    expect(mapped["A.new1"]).toEqual({ from: 6, to: 6 });
    expect(mapped["A.get"]).toEqual({ from: 7, to: 9 });
    expect(outcome.ran?.stdout).toBe("8\n");
  });

  it("answers a program with mistakes with the mistakes and no module", () => {
    const { outcome } = handleRequest({ type: "compile", id: 1, source: 'int x = "no";' });
    expect(outcome.ok).toBe(false);
    expect(outcome.diagnostics.map((d) => d.message)).toEqual(["cannot assign string to int"]);
    expect(outcome.ran).toBeNull();
    expect(outcome.functions).toEqual([]);
  });

  it("keeps what a compiled program printed before its mistake", () => {
    const { outcome } = handleRequest({ type: "compile", id: 1, source: 'System.out.println("a"); int z = 0; System.out.println(1 / z);' });
    expect(outcome.ok).toBe(true);
    expect(outcome.ran?.stdout).toBe("a\n");
    expect(outcome.ran?.diagnostics.map((d) => d.message)).toEqual(["division by zero"]);
  });

  it("compares the two modes on one program", () => {
    const { outcome } = handleRequest({ type: "compare", id: 1, source: SIEVE });
    expect(outcome.outputs).toBe("identical");
    expect(outcome.interpreted.stdout).toBe("25\n");
    expect(outcome.compiled.ran?.stdout).toBe("25\n");
    expect(outcome.interpreted.ms).toBeGreaterThan(0);
    expect(outcome.note).toBeNull();
  });

  it("says why two runs cannot be compared", () => {
    expect(handleRequest({ type: "compare", id: 1, source: "int x = ;" }).outcome).toMatchObject({ outputs: "not comparable", note: "the program does not compile" });
    expect(handleRequest({ type: "compare", id: 1, source: "int z = 0; int y = 1 / z;" }).outcome).toMatchObject({ outputs: "not comparable" });
    expect(handleRequest({ type: "compare", id: 1, source: "System.out.println(time());" }).outcome).toMatchObject({ outputs: "not comparable", note: "the program prints the time of day" });
  });
});

describe("the run client: compile and compare", () => {
  it("compiles through the worker and resolves with its answer", async () => {
    const { client, workers } = clientWith();
    const promise = client.compile("int x = 1;");
    const worker = workers[0] as FakeWorker;
    expect(worker.requests).toEqual([{ type: "compile", source: "int x = 1;", id: 1 }]);
    worker.reply(handleRequest(worker.requests[0] as WorkerRequest));
    const end = await promise;
    expect(end.kind).toBe("done");
    if (end.kind === "done") expect(end.outcome.ok).toBe(true);
  });

  it("ignores an answer of another kind or another request", async () => {
    const { client, workers } = clientWith();
    const promise = client.compare("int x = 1;");
    const worker = workers[0] as FakeWorker;
    worker.reply(handleRequest({ type: "run", id: 1, source: "int x;" }));
    worker.reply(handleRequest({ type: "compile", id: 1, source: "int x;" }));
    expect(client.running).toBe(true);
    worker.reply(handleRequest({ type: "compare", id: 1, source: "int x = 1;" }));
    const end = await promise;
    expect(end.kind).toBe("done");
  });

  it("ends a compiled program that never ends after its own, shorter limit", async () => {
    vi.useFakeTimers();
    try {
      const { client, workers } = clientWith(12_000);
      const promise = client.compile("while (true) { }");
      await vi.advanceTimersByTimeAsync(5001);
      expect(await promise).toEqual({ kind: "stopped", timedOut: true });
      expect((workers[0] as FakeWorker).terminated).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops a compile, and the next request gets a fresh worker", async () => {
    const { client, workers } = clientWith();
    const first = client.compile("a");
    client.stop();
    expect(await first).toEqual({ kind: "stopped" });
    void client.run("b");
    expect(workers).toHaveLength(2);
    expect((workers[0] as FakeWorker).terminated).toBe(true);
  });
});
