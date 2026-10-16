import { describe, expect, it } from "vitest";
import { run } from "../../src/core/run";
import { renderValue, TraceReplayer, type ReplayState } from "../../src/core/trace/replay";
import type { Trace } from "../../src/core/trace/types";
import { EXAMPLES } from "../../src/examples";

function traced(source: string) {
  const result = run(source);
  expect(result.diagnostics).toEqual([]);
  expect(result.trace).not.toBeNull();
  const trace = result.trace as Trace;
  return { result, trace, replay: new TraceReplayer(trace) };
}

const variables = (state: ReplayState): string[] =>
  state.frames.flatMap((frame) => frame.scopes.flatMap((scope) => scope.vars.map((v) => `${frame.name}: ${v.name}=${renderValue(state, v.value, v.type)}`)));

const SOURCE = `class Counter {
    int n;
    string label;
    Counter(string label) { this.label = label; n = 1; }
    void inc() { n++; }
}
Counter c = new Counter("clicks");
c.inc();
c.inc();
System.out.println(c.n);
`;

describe("objects in the trace (S-10)", () => {
  it("shows the constructor frame with this and its parameters, and the object filling in", () => {
    const { trace, replay } = traced(SOURCE);
    // Find the step where `n = 1;` has just run inside the constructor.
    const index = trace.steps.findIndex((step) => SOURCE.slice(step.span.start.offset, step.span.end.offset) === "n = 1;");
    expect(index).toBeGreaterThan(-1);
    const state = replay.stateAt(index);
    expect(state.frames.map((f) => f.name)).toEqual(["global", "new Counter"]);
    expect(variables(state)).toContain("new Counter: this=Counter{n: 1, label: clicks}");
    expect(variables(state)).toContain("new Counter: label=clicks");
  });

  it("shows this inside a method, named after the class that wrote the method", () => {
    const { trace, replay } = traced(SOURCE);
    const index = trace.steps.findIndex((step) => SOURCE.slice(step.span.start.offset, step.span.end.offset) === "n++;");
    const state = replay.stateAt(index);
    expect(state.frames.map((f) => f.name)).toEqual(["global", "Counter.inc"]);
    expect(variables(state)).toContain("Counter.inc: this=Counter{n: 2, label: clicks}");
  });

  it("ends with the object in the global variable and the field values after every change", () => {
    const { trace, replay } = traced(SOURCE);
    const end = replay.stateAt(trace.steps.length - 1);
    expect(variables(end)).toEqual(["global: c=Counter{n: 3, label: clicks}"]);
    const object = [...end.heap.values()].find((o) => o.type === "Counter");
    expect(object?.fields?.map((f) => f.name)).toEqual(["n", "label"]);
  });

  it("records the real class of an object held by a variable of its parent type", () => {
    const { replay, trace } = traced("class A { int x; } class B extends A { int y; } A a = new B(); a.x = 4;");
    const end = replay.stateAt(trace.steps.length - 1);
    expect([...end.heap.values()].map((o) => o.type)).toEqual(["B"]);
    expect(variables(end)).toEqual(["global: a=B{x: 4, y: 0}"]);
  });

  it("lists the fields of a parent first, so that they line up with the parent's layout", () => {
    const { replay, trace } = traced("class A { int x; } class B extends A { int y; } B b = new B(); b.y = 2; b.x = 1;");
    const end = replay.stateAt(trace.steps.length - 1);
    expect([...end.heap.values()][0]?.fields?.map((f) => f.name)).toEqual(["x", "y"]);
  });

  it("does not hang on objects that point to each other", () => {
    const { replay, trace, result } = traced("class N { N next; } N a = new N(); N b = new N(); a.next = b; b.next = a; System.out.println(a);");
    expect(result.stdout).toBe("N{next: N{next: N{...}}}\n");
    const end = replay.stateAt(trace.steps.length - 1);
    expect(variables(end).join(" ")).toContain("a=N{next: N{next: N{…}}}");
  });
});

describe("replaying a program with classes in any order gives the same states", () => {
  const key = (state: ReplayState): string => JSON.stringify({ frames: state.frames, heap: [...state.heap].sort(([a], [b]) => a - b), out: state.outputLength });

  function shuffled(count: number, seed: number): number[] {
    const order = Array.from({ length: count }, (_, i) => i - 1);
    let x = seed;
    for (let i = order.length - 1; i > 0; i--) {
      x = (x * 1664525 + 1013904223) >>> 0;
      const j = x % (i + 1);
      [order[i], order[j]] = [order[j] as number, order[i] as number];
    }
    return order;
  }

  const programs: [string, string][] = [
    ["counter", SOURCE],
    ...EXAMPLES.filter((e) => e.source.includes("class ")).map((e): [string, string] => [e.id, e.source]),
  ];

  it.each(programs)("%s", (_name, source) => {
    const result = run(source);
    expect(result.trace).not.toBeNull();
    const trace = result.trace as Trace;
    const sequential = new TraceReplayer(trace);
    const expected: string[] = [];
    for (let i = -1; i < trace.steps.length; i++) expected.push(key(sequential.stateAt(i)));
    const random = new TraceReplayer(trace);
    for (const index of shuffled(trace.steps.length + 1, 777)) expect(key(random.stateAt(index)), `step ${index}`).toBe(expected[index + 1]);
    const backwards = new TraceReplayer(trace);
    for (let i = trace.steps.length - 1; i >= -1; i--) expect(key(backwards.stateAt(i)), `step ${i} (backwards)`).toBe(expected[i + 1]);
  });
});
