// Builds docs/design/mockups/data.js: real data from the rebuilt interpreter for the design mockups.
// The mockups are static pages, so they cannot run the interpreter; this file is what it produced for the
// diamond program (tests/fixtures/prueba/1- Ciclos.txt), sampled so that it stays small.
//
//   npx tsx scripts/mockup-data.ts
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AstNode } from "../src/core/astView";
import { tokenize } from "../src/core/lexer/lexer";
import { run } from "../src/core/run";
import { renderValue, TraceReplayer } from "../src/core/trace/replay";

const root = join(import.meta.dirname, "..");
const read = (path: string): string => readFileSync(join(root, path), "utf8");

const source = read("tests/fixtures/prueba/1- Ciclos.txt");
const FIXED_NOW = Date.parse("2024-09-20T12:00:00.000Z");
const started = performance.now();
const result = run(source, { now: () => FIXED_NOW });
const elapsedMs = Math.max(1, Math.round(performance.now() - started));
const trace = result.trace;
if (!trace) throw new Error("no trace");

// ---- highlighted source: per line, a list of [class, text]
const TYPES = new Set(["int", "float", "string", "boolean", "char", "void", "var"]);
const LITERALS = new Set(["true", "false", "null"]);
const tokens = tokenize(source, { includeComments: true }).tokens.filter((t) => t.type !== "eof");
const classOf = (index: number): string => {
  const t = tokens[index]!;
  if (t.type === "comment") return "cm";
  if (t.type === "keyword") return TYPES.has(t.text) ? "ty" : LITERALS.has(t.text) ? "lit" : "kw";
  if (t.type === "int" || t.type === "float") return "num";
  if (t.type === "string" || t.type === "char") return "str";
  if (t.type === "identifier") return tokens[index + 1]?.text === "(" ? "fn" : "id";
  return "p";
};
const pieces: [string, string][] = [];
let cursor = 0;
tokens.forEach((t, i) => {
  if (t.span.start.offset > cursor) pieces.push(["ws", source.slice(cursor, t.span.start.offset)]);
  pieces.push([classOf(i), t.text]);
  cursor = t.span.end.offset;
});
if (cursor < source.length) pieces.push(["ws", source.slice(cursor)]);
const lines: [string, string][][] = [[]];
for (const [cls, text] of pieces) {
  const parts = text.split("\n");
  parts.forEach((part, k) => {
    if (k > 0) lines.push([]);
    if (part !== "") lines[lines.length - 1]!.push([cls, part.replace(/\r/g, "")]);
  });
}

// ---- snapshots of the trace
const replayer = new TraceReplayer(trace);
const STRIDE = 100;
const snapshots = [] as unknown[];
const indices: number[] = [];
for (let i = 0; i < trace.steps.length; i += STRIDE) indices.push(i);
indices.push(trace.steps.length - 1);
let previousVariables = new Map<string, string>();
for (const index of indices) {
  const step = trace.steps[index]!;
  const state = replayer.stateAt(index);
  const variables = state.frames.flatMap((frame) =>
    frame.scopes.flatMap((scope) =>
      scope.vars.map((v) => ({ name: v.name, type: v.type, value: renderValue(state, v.value, v.type, true), scope: scope.label })),
    ),
  );
  const marked = variables.map((v) => ({ ...v, changed: previousVariables.get(v.name) !== v.value }));
  previousVariables = new Map(variables.map((v) => [v.name, v.value]));
  const printed = result.stdout.slice(0, state.outputLength);
  snapshots.push({
    index,
    kind: step.kind,
    note: step.note,
    line: step.span.start.line,
    endLine: step.span.end.line,
    startColumn: step.span.start.column,
    endColumn: step.span.end.column,
    frames: state.frames.map((f) => f.name),
    variables: marked,
    rows: printed.split("\n").length - 1,
    printedChars: state.outputLength,
  });
}

// ---- the syntax tree of one statement (the inner `if` of the diamond), not of the whole program
const findIf = (node: AstNode): AstNode | null => {
  if (node.kind === "If" && node.span.start.line === 23) return node;
  for (const child of node.children) {
    const found = findIf(child);
    if (found) return found;
  }
  return null;
};
const pruneAst = (node: AstNode, depth: number): unknown => ({
  kind: node.kind,
  label: node.label,
  line: node.span.start.line,
  children: depth <= 0 ? [] : node.children.map((c) => pruneAst(c, depth - 1)),
  more: depth <= 0 ? node.children.length : 0,
});
const ifNode = findIf(result.ast);

// For every line a statement starts on: that statement's tree (the outermost one that starts there, not a block).
const treesByLine: Record<number, unknown> = {};
const collect = (node: AstNode): void => {
  const line = node.span.start.line;
  const isStatement = !["Program", "Block", "Literal", "Identifier", "Binary", "Unary", "Group", "Call", "Index", "Member", "Ternary", "Assign"].includes(node.kind);
  if (isStatement && treesByLine[line] === undefined) treesByLine[line] = pruneAst(node, 5);
  node.children.forEach(collect);
};
collect(result.ast);

// ---- real problems, from the sample that has some on purpose
const basicas = run(read("tests/fixtures/prueba/basicas.oak"));

const data = {
  program: { name: "1- Ciclos.txt", title: "Diamond", source, lines },
  run: {
    steps: trace.steps.length,
    truncated: trace.truncated,
    evaluated: result.steps,
    elapsedMs,
    rows: result.stdout.split("\n").length - 1,
    stdout: result.stdout,
  },
  snapshots,
  stride: STRIDE,
  ast: ifNode ? pruneAst(ifNode, 5) : null,
  trees: treesByLine,
  astTotal: countNodes(result.ast),
  symbols: result.symbols.map((s) => ({ name: s.name, kind: s.kind, type: s.type, scope: s.scope, line: s.span.start.line, column: s.span.start.column })),
  problems: {
    from: "basicas.oak",
    items: basicas.diagnostics.map((d) => ({ phase: d.phase, message: d.message, line: d.span.start.line, column: d.span.start.column })),
  },
};

function countNodes(node: AstNode): number {
  return 1 + node.children.reduce((sum, child) => sum + countNodes(child), 0);
}

writeFileSync(join(root, "docs", "design", "mockups", "data.js"), `// Generated by scripts/mockup-data.ts. Do not edit.\nwindow.OAK = ${JSON.stringify(data)};\n`);
console.log(`wrote data.js: ${snapshots.length} snapshots, ${data.run.steps} steps, ${data.symbols.length} symbols, ast nodes ${data.astTotal}`);
