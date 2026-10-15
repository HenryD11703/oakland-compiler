import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_TRACE_STEPS, type Trace } from "../../src/core/trace/types";
import { renderValue, TraceReplayer, type ReplayState } from "../../src/core/trace/replay";
import { run } from "../../src/core/run";

function traced(source: string) {
  const result = run(source);
  expect(result.trace).not.toBeNull();
  const trace = result.trace as Trace;
  return { result, trace, replay: new TraceReplayer(trace) };
}

/** `frame/scope: name=value` for every visible variable, outermost first. */
function variables(state: ReplayState): string[] {
  return state.frames.flatMap((frame) =>
    frame.scopes.flatMap((scope) => scope.vars.map((v) => `${frame.name}/${scope.label}: ${v.name}=${renderValue(state, v.value, v.type)}`)),
  );
}

/** The source text a step highlights. */
function highlighted(source: string, trace: Trace, index: number): string {
  const span = (trace.steps[index] as Trace["steps"][number]).span;
  return source.slice(span.start.offset, span.end.offset);
}

describe("one step per statement (AC-31)", () => {
  const source = "int x = 1;\nx = x + 2;\nSystem.out.println(x);";

  it("records each statement and an end step, highlighting its source", () => {
    const { trace } = traced(source);
    expect(trace.steps.map((s) => s.kind)).toEqual(["statement", "statement", "statement", "end"]);
    expect([0, 1, 2].map((i) => highlighted(source, trace, i))).toEqual(["int x = 1;", "x = x + 2;", "System.out.println(x);"]);
    expect(trace.truncated).toBe(false);
  });

  it("shows the variables after each step", () => {
    const { replay } = traced(source);
    expect(variables(replay.stateAt(-1))).toEqual([]);
    expect(variables(replay.stateAt(0))).toEqual(["global/global: x=1"]);
    expect(variables(replay.stateAt(1))).toEqual(["global/global: x=3"]);
    expect(variables(replay.stateAt(3))).toEqual(["global/global: x=3"]);
  });

  it("tells which variable a step changed", () => {
    const { replay } = traced("int a = 1; int b = 2; a = 5;");
    const idOf = (index: number): number[] => [...replay.changesAt(index).variables];
    expect(idOf(0)).toHaveLength(1);
    expect(idOf(1)).toHaveLength(1);
    expect(idOf(2)).toEqual(idOf(0)); // the assignment touches a, declared in step 0
    expect(idOf(0)).not.toEqual(idOf(1));
  });

  it("knows how much had been printed at each step", () => {
    const { result, trace, replay } = traced('System.out.println("a"); System.out.println("bc");');
    expect(replay.stateAt(0).outputLength).toBe(2);
    expect(replay.stateAt(1).outputLength).toBe(5);
    expect(result.stdout.slice(0, replay.stateAt(0).outputLength)).toBe("a\n");
    expect(trace.steps.at(-1)?.outputLength).toBe(result.stdout.length);
  });

  it("is off when asked", () => {
    expect(run(source, { trace: false }).trace).toBeNull();
  });

  it("is absent when the program has syntax errors", () => {
    expect(run("int x = ;").trace).toBeNull();
  });
});

describe("scopes", () => {
  it("keeps a block's variables visible while its last statement is highlighted", () => {
    const { replay, trace } = traced("int a = 1;\n{\n  int b = 2;\n  a = b;\n}\nint c = 3;");
    // steps: a, b, a = b, c, end
    expect(trace.steps.map((s) => s.kind)).toEqual(["statement", "statement", "statement", "statement", "end"]);
    expect(variables(replay.stateAt(1))).toEqual(["global/global: a=1", "global/block: b=2"]);
    expect(variables(replay.stateAt(2))).toEqual(["global/global: a=2", "global/block: b=2"]);
    expect(variables(replay.stateAt(3))).toEqual(["global/global: a=2", "global/global: c=3"]);
  });

  it("gives a for loop its own scope and one step per condition and update", () => {
    const source = "for (int i = 0; i < 2; i++) { System.out.println(i); }";
    const { replay, trace } = traced(source);
    expect(trace.steps.map((s) => `${s.kind}${s.note ? `(${s.note})` : ""}`)).toEqual([
      "statement", // int i = 0
      "condition(true)",
      "statement", // println(0)
      "statement", // i++
      "condition(true)",
      "statement",
      "statement",
      "condition(false)",
      "end",
    ]);
    expect(variables(replay.stateAt(0))).toEqual(["global/for: i=0"]);
    expect(variables(replay.stateAt(3))).toEqual(["global/for: i=1"]);
    expect(variables(replay.stateAt(8))).toEqual([]);
  });

  it("notes the result of each condition", () => {
    const { trace } = traced("int i = 0; while (i < 2) { i++; } if (i == 2) { i = 5; } else { i = 6; }");
    expect(trace.steps.filter((s) => s.kind === "condition").map((s) => s.note)).toEqual(["true", "true", "false", "true"]);
  });

  it("takes one step per for-each iteration and declares the loop variable in it", () => {
    const { replay, trace } = traced("int[] a = {10, 20}; for (int v : a) { System.out.println(v); }");
    const iterations = trace.steps.flatMap((s, i) => (s.kind === "iteration" ? [i] : []));
    expect(iterations).toHaveLength(2);
    expect(variables(replay.stateAt(iterations[0] as number))).toEqual(["global/global: a=[10, 20]", "global/for-each: v=10"]);
    expect(variables(replay.stateAt(iterations[1] as number))).toEqual(["global/global: a=[10, 20]", "global/for-each: v=20"]);
  });

  it("opens a scope for a switch and steps on its subject", () => {
    const { trace, replay } = traced("int d = 2; switch (d) { case 1: int a = 1; break; case 2: int b = 2; break; }");
    const condition = trace.steps.findIndex((s) => s.kind === "condition");
    expect(trace.steps[condition]?.span.start.offset).toBe(19);
    const declared = trace.steps.findIndex((s, i) => i > condition && s.kind === "statement");
    expect(variables(replay.stateAt(declared))).toEqual(["global/global: d=2", "global/switch: b=2"]);
  });
});

describe("calls", () => {
  const source = "int f(int n) {\n  return n * 2;\n}\nint y = f(3);\nSystem.out.println(y);";

  it("enters the function, shows its parameters, and comes back to the calling line", () => {
    const { trace, replay } = traced(source);
    expect(trace.steps.map((s) => `${s.kind}:${highlighted(source, trace, trace.steps.indexOf(s))}`)).toEqual([
      "statement:int y = f(3);",
      "statement:return n * 2;",
      "return:int y = f(3);",
      "statement:System.out.println(y);",
      "end:",
    ]);
    // at the call: only the global frame, y not declared yet
    expect(variables(replay.stateAt(0))).toEqual([]);
    // inside f: the new frame holds n
    const inside = replay.stateAt(1);
    expect(inside.frames.map((f) => f.name)).toEqual(["global", "f"]);
    expect(variables(inside)).toEqual(["f/function f: n=3"]);
    // back at the calling line: the frame is gone and y has its value
    expect(trace.steps[2]?.note).toBe("returned 6");
    expect(replay.stateAt(2).frames.map((f) => f.name)).toEqual(["global"]);
    expect(variables(replay.stateAt(2))).toEqual(["global/global: y=6"]);
  });

  it("stacks one frame per recursive call", () => {
    const { replay, trace } = traced("int fact(int n) { if (n == 0) { return 1; } return n * fact(n - 1); } System.out.println(fact(3));");
    let deepest = 0;
    for (let i = 0; i < trace.steps.length; i++) deepest = Math.max(deepest, replay.stateAt(i).frames.length);
    expect(deepest).toBe(5); // global + fact(3), fact(2), fact(1), fact(0)
    expect(replay.stateAt(trace.steps.length - 1).frames.map((f) => f.name)).toEqual(["global"]);
  });

  it("shows the same variable in the frame that owns it, not in the caller", () => {
    const { replay, trace } = traced("int g = 1; void bump() { g = g + 1; } bump(); bump();");
    const last = replay.stateAt(trace.steps.length - 1);
    expect(variables(last)).toEqual(["global/global: g=3"]);
  });
});

describe("arrays and structs on the heap", () => {
  it("shows a change made through one name in every name that shares the array", () => {
    const { replay, trace } = traced("int[] a = {1};\nint[] b = {2};\nb = a;\na[0] = 9;");
    const last = replay.stateAt(trace.steps.length - 1);
    expect(variables(last)).toEqual(["global/global: a=[9]", "global/global: b=[9]"]);
    expect(replay.changesAt(3).objects.size).toBe(1);
  });

  it("shows array elements and struct fields as they change", () => {
    const { replay, trace } = traced('struct P { string name; int age; }\nP p = P{name: "Ana", age: 20};\np.age = 21;\np.age++;\nint[] a = {1, 2};\na[1] += 5;');
    const states = trace.steps.map((_, i) => variables(replay.stateAt(i)));
    expect(states.some((s) => s.includes("global/global: p=P{name: Ana, age: 20}"))).toBe(true);
    expect(variables(replay.stateAt(trace.steps.length - 1))).toEqual(["global/global: p=P{name: Ana, age: 22}", "global/global: a=[1, 7]"]);
  });

  it("quotes strings and chars when asked", () => {
    const { replay } = traced("string[] s = {\"a\"}; char c = 'x';");
    const state = replay.stateAt(1);
    const quoted = (name: string): string => {
      const found = state.frames.flatMap((f) => f.scopes.flatMap((sc) => sc.vars)).find((v) => v.name === name);
      return found ? renderValue(state, found.value, found.type, true) : "missing";
    };
    expect(quoted("s")).toBe('["a"]');
    expect(quoted("c")).toBe("'x'");
  });

  it("keeps only the first items of a big array but its true length", () => {
    const { replay, trace } = traced("int[] big = new int[500]; big[3] = 7; big[450] = 1;");
    const text = variables(replay.stateAt(trace.steps.length - 1))[0] ?? "";
    expect(text.startsWith("global/global: big=[0, 0, 0, 7, 0")).toBe(true);
    expect(text.endsWith("… 400 more]")).toBe(true);
  });

  it("does not loop on a struct that contains itself", () => {
    const { replay, trace } = traced("struct N { N next; int v; } N a = N{v: 1}; a.next = a;");
    expect(variables(replay.stateAt(trace.steps.length - 1))[0]).toBe("global/global: a=N{next: N{…}, v: 1}");
  });
});

describe("mistakes in the trace", () => {
  it("shows a variable whose declaration failed as null", () => {
    const { replay } = traced('int a = "x"; a = 5;');
    expect(variables(replay.stateAt(0))).toEqual(["global/global: a=null"]);
    expect(variables(replay.stateAt(1))).toEqual(["global/global: a=5"]);
  });

  it("is still produced when a limit stops the run, and ends there", { timeout: 30_000 }, () => {
    const { trace, result } = traced("int i = 0; while (true) { i++; }");
    expect(result.stoppedEarly).toBe(true);
    expect(trace.steps.length).toBeLessThanOrEqual(MAX_TRACE_STEPS + 1);
    expect(trace.truncated).toBe(true);
  });
});

describe("the step limit (AC-31)", () => {
  it("stops recording at the maximum, reports it, and still completes the run", () => {
    const { trace, result } = traced("int s = 0; for (int i = 0; i < 20000; i++) { s += i; } System.out.println(s);");
    expect(trace.truncated).toBe(true);
    expect(trace.steps).toHaveLength(MAX_TRACE_STEPS);
    expect(result.stdout).toBe("199990000\n");
    expect(result.stoppedEarly).toBe(false);
  });

  it("does not flag a program that fits", () => {
    expect(traced("int a = 1;").trace.truncated).toBe(false);
  });
});

describe("replaying in any order gives the same states", () => {
  const key = (state: ReplayState): string =>
    JSON.stringify({
      frames: state.frames,
      heap: [...state.heap].sort(([a], [b]) => a - b),
      out: state.outputLength,
    });

  /** A small deterministic shuffle. */
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

  const fixtures = join(import.meta.dirname, "..", "fixtures", "prueba");
  const programs: [string, string][] = [
    ...readdirSync(fixtures).map((file): [string, string] => [file, readFileSync(join(fixtures, file), "utf8")]),
    ["loop with arrays", "int[] a = new int[50]; for (int i = 0; i < 400; i++) { a[i % 50] += i; if (i % 100 == 0) { System.out.println(i); } }"],
  ];

  it.each(programs)("%s", (_name, source) => {
    const { trace } = traced(source);
    const sequential = new TraceReplayer(trace);
    const expected: string[] = [];
    for (let i = -1; i < trace.steps.length; i++) expected.push(key(sequential.stateAt(i)));

    const random = new TraceReplayer(trace);
    for (const index of shuffled(trace.steps.length + 1, 12345)) {
      expect(key(random.stateAt(index)), `step ${index}`).toBe(expected[index + 1]);
    }
    // and walking backwards from the end
    const backwards = new TraceReplayer(trace);
    for (let i = trace.steps.length - 1; i >= -1; i--) {
      expect(key(backwards.stateAt(i)), `step ${i} (backwards)`).toBe(expected[i + 1]);
    }
  });

  it("crosses at least one checkpoint in the long case", () => {
    const { trace } = traced("int s = 0; for (int i = 0; i < 400; i++) { s += i; }");
    expect(trace.steps.length).toBeGreaterThan(TraceReplayer.CHECKPOINT_EVERY * 2);
  });
});
