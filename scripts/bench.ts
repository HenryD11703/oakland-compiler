// Times the interpreter on the programs in bench/. Run with `npm run bench`.
// Usage: npm run bench [-- --runs 5]
import { readdirSync, readFileSync } from "node:fs";
import { cpus } from "node:os";
import { join } from "node:path";
import { run } from "../src/core/index";

const runsArg = process.argv.indexOf("--runs");
const RUNS = runsArg > 0 ? Number(process.argv[runsArg + 1]) : 5;
// The default limits (20 M steps, 5 s) would end the slower programs early; a benchmark must finish.
const limits = { maxSteps: 2_000_000_000, maxTimeMs: 300_000 };

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function time(source: string, trace: boolean): { ms: number; stdout: string; steps: number } {
  const start = performance.now();
  const result = run(source, { trace, limits });
  const ms = performance.now() - start;
  if (result.diagnostics.length > 0 || result.stoppedEarly) {
    throw new Error(`the benchmark program had problems: ${result.diagnostics.map((d) => d.message).join("; ")}`);
  }
  return { ms, stdout: result.stdout.trim(), steps: result.steps };
}

const dir = join(import.meta.dirname, "..", "bench");
const files = readdirSync(dir).filter((f) => f.endsWith(".oak")).sort();

console.log(`Node ${process.version} on ${cpus()[0]?.model ?? "unknown CPU"} (${cpus().length} threads), median of ${RUNS} runs after one warm-up\n`);
console.log("| Program | Interpreter, with trace (ms) | Interpreter, no trace (ms) | Steps | Output |");
console.log("|---|---:|---:|---:|---|");
for (const file of files) {
  const source = readFileSync(join(dir, file), "utf8");
  time(source, false); // warm-up: the engine compiles the interpreter's hot paths
  const withTrace: number[] = [];
  const without: number[] = [];
  let sample = { stdout: "", steps: 0 };
  for (let i = 0; i < RUNS; i++) {
    withTrace.push(time(source, true).ms);
    const plain = time(source, false);
    without.push(plain.ms);
    sample = plain;
  }
  console.log(`| ${file.replace(".oak", "")} | ${median(withTrace).toFixed(0)} | ${median(without).toFixed(0)} | ${sample.steps.toLocaleString("en-US")} | ${sample.stdout} |`);
}
