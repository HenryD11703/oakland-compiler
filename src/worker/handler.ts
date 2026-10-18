import { toAstView } from "../core/astView";
import { compile, runCompiled, type CompileResult } from "../core/compile/index";
import { parse } from "../core/parser/parser";
import type { Program } from "../core/parser/ast";
import { run } from "../core/run";
import { TraceReplayer } from "../core/trace/replay";
import { numericSeries } from "../core/trace/series";
import type { CompareOutcome, CompareRequest, CompileOutcome, CompileRequest, CompiledFunction, ComparedResponse, CompiledResponse, ResultResponse, RunRequest, WorkerRequest, WorkerResponse } from "./protocol";

/** Answers a request. Pure, so it is tested without a worker; the worker file only wires it to messages. */
export function handleRequest(request: RunRequest): ResultResponse;
export function handleRequest(request: CompileRequest): CompiledResponse;
export function handleRequest(request: CompareRequest): ComparedResponse;
export function handleRequest(request: WorkerRequest): WorkerResponse;
export function handleRequest(request: WorkerRequest): WorkerResponse {
  if (request.type === "compile") return { type: "compiled", id: request.id, outcome: compileAndRun(request.source) };
  if (request.type === "compare") return { type: "compared", id: request.id, outcome: compare(request.source) };
  const result = run(request.source);
  const series = result.trace ? numericSeries(result.trace) : [];
  const trace = result.trace;
  const finalState = trace && trace.steps.length > 0 ? new TraceReplayer(trace).stateAt(trace.steps.length - 1) : null;
  return { type: "result", id: request.id, outcome: { result, series, finalState } };
}

/** The line range of each function of the program that has a name in the module (the others map to nothing). */
function sourceRanges(program: Program): Map<string, { from: number; to: number }> {
  const ranges = new Map<string, { from: number; to: number }>();
  const lines = (span: { start: { line: number }; end: { line: number } }): { from: number; to: number } => ({ from: span.start.line, to: span.end.line });
  ranges.set("main", { from: 1, to: program.span.end.line });
  for (const statement of program.body) {
    if (statement.kind === "FuncDecl") ranges.set(statement.name, lines(statement.span));
    else if (statement.kind === "ClassDecl") {
      for (const member of statement.members) {
        if (member.kind === "MethodDecl") ranges.set(`${statement.name}.${member.name}`, lines(member.span));
        else if (member.kind === "CtorDecl") ranges.set(`${statement.name}.new${member.params.length}`, lines(member.span));
      }
    }
  }
  return ranges;
}

/** The module's WebAssembly text cut into its functions, each with its origin and (when known) its source lines. */
function splitFunctions(wat: string, ranges: ReadonlyMap<string, { from: number; to: number }>): CompiledFunction[] {
  const functions: { name: string; lines: string[] }[] = [];
  let current: { name: string; lines: string[] } | null = null;
  for (const line of wat.split("\n")) {
    const start = /^ {2}\(func \$([^ )]+)/.exec(line);
    if (start) {
      current = { name: start[1] as string, lines: [line] };
      functions.push(current);
    } else if (current !== null && (line.startsWith("   ") || line === "  )")) {
      current.lines.push(line);
    } else if (current !== null && !line.startsWith("  ")) {
      current = null;
    }
  }
  return functions.map((f) => ({
    name: f.name,
    origin: f.name.startsWith("rt:") ? "runtime" : "yours",
    lines: f.lines,
    source: ranges.get(f.name) ?? null,
  }));
}

function compileAndRun(source: string): CompileOutcome {
  const parsed = parse(source);
  const started = performance.now();
  const result: CompileResult = compile(source);
  const compileMs = performance.now() - started;
  const ast = parsed.diagnostics.length === 0 ? toAstView(parsed.program) : null;
  if (!result.ok || result.wasm === null) {
    return { ok: false, diagnostics: result.diagnostics, bytes: 0, watLines: 0, functions: [], compileMs, ast, ran: null, runMs: null };
  }
  const functions = splitFunctions(result.wat ?? "", sourceRanges(parsed.program));
  const ranAt = performance.now();
  const ran = runCompiled(result);
  const runMs = performance.now() - ranAt;
  return { ok: true, diagnostics: [], bytes: result.wasm.length, watLines: (result.wat ?? "").split("\n").length, functions, compileMs, ast, ran, runMs };
}

function compare(source: string): CompareOutcome {
  const started = performance.now();
  // Without the trace, as the benchmarks time it: the trace is what makes the interpreter slow to *watch*, not to run.
  const interpretation = run(source, { trace: false });
  const interpreted = { stdout: interpretation.stdout, diagnostics: interpretation.diagnostics, stoppedEarly: interpretation.stoppedEarly, ms: performance.now() - started };
  const compiled = compileAndRun(source);
  let outputs: CompareOutcome["outputs"] = "not comparable";
  let note: string | null = null;
  if (!compiled.ok) note = "the program does not compile";
  else if (interpreted.stoppedEarly || interpreted.diagnostics.some((d) => d.phase === "runtime" || d.phase === "semantic")) note = "the interpreter ended with a mistake or a limit";
  else if (compiled.ran?.diagnostics.length) note = "the compiled program ended with a mistake";
  else if (/\btime\(\)/.test(source)) note = "the program prints the time of day";
  else outputs = compiled.ran?.stdout === interpreted.stdout ? "identical" : "different";
  return { interpreted, compiled, outputs, note };
}
