// Times the interpreter and the compiler on the programs in bench/. Run with `npm run bench`.
// Usage: npm run bench [-- --runs 5]
//
// For each program: the original course interpreter (where its older syntax can run it), the rebuilt interpreter with and
// without the trace, and the compiled program (what compiling cost, how big the module is, how long it takes to run).
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, platform, release, totalmem } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

// The core is built with Vite first, as it is for the site. Running the TypeScript through tsx would add
// esbuild's `keepNames` helper to every closure and make the interpreter two to three times slower than it is.
const root = join(import.meta.dirname, "..");
const outDir = join(root, "node_modules", ".cache", "oakland-bench");
const shell = process.platform === "win32";
execFileSync("npx", ["vite", "build", "--ssr", "src/core/index.ts", "--outDir", outDir, "--emptyOutDir", "--logLevel", "error"], { cwd: root, stdio: "inherit", shell });
const { run, compile, runCompiled } = (await import(pathToFileURL(join(outDir, "index.js")).href)) as typeof import("../src/core/index");

const runsArg = process.argv.indexOf("--runs");
const RUNS = runsArg > 0 ? Number(process.argv[runsArg + 1]) : 5;
// The default limits (20 M steps, 5 s) would end the slower programs early; a benchmark must finish.
const limits = { maxSteps: 2_000_000_000, maxTimeMs: 300_000 };

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function timeInterpreter(source: string, trace: boolean): { ms: number; stdout: string; steps: number } {
  const start = performance.now();
  const result = run(source, { trace, limits });
  const ms = performance.now() - start;
  if (result.diagnostics.length > 0 || result.stoppedEarly) {
    throw new Error(`the benchmark program had problems: ${result.diagnostics.map((d) => d.message).join("; ")}`);
  }
  return { ms, stdout: result.stdout.trim(), steps: result.steps };
}

function timeCompiled(source: string): { compileMs: number; runMs: number; stdout: string; bytes: number } {
  const t0 = performance.now();
  const compiled = compile(source);
  const t1 = performance.now();
  if (!compiled.ok || compiled.wasm === null) throw new Error(`the benchmark program did not compile: ${compiled.diagnostics.map((d) => d.message).join("; ")}`);
  const ran = runCompiled(compiled);
  const t2 = performance.now();
  if (ran.diagnostics.length > 0) throw new Error(`the compiled benchmark had problems: ${ran.diagnostics.map((d) => d.message).join("; ")}`);
  return { compileMs: t1 - t0, runMs: t2 - t1, stdout: ran.stdout.trim(), bytes: compiled.wasm.length };
}

// ---- the original interpreter (git commit 11b0e46), taken out of git the way scripts/capture-legacy.mjs does ----
type Legacy = (source: string) => { stdout: string; errors: number };
async function loadLegacy(): Promise<Legacy | null> {
  try {
    const dir = join(outDir, "legacy");
    const git = (...args: string[]): Buffer => execFileSync("git", args, { cwd: root, maxBuffer: 64 * 1024 * 1024 });
    const wanted = git("ls-tree", "-r", "--name-only", "11b0e46")
      .toString()
      .split("\n")
      .filter((path) => path === "nodos.js" || path === "visitor.js" || (path.startsWith("Interpreter/") && path.endsWith(".js")));
    for (const path of wanted) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), git("show", `11b0e46:${path}`));
    }
    writeFileSync(join(dir, "package.json"), '{"type":"module"}\n');
    const { parse } = await import(pathToFileURL(join(dir, "Interpreter", "gramatica.js")).href);
    const { InterpretarVisitor } = await import(pathToFileURL(join(dir, "Interpreter", "Interprete.js")).href);
    return (source) => {
      // The original has no `i++`.
      const adapted = source.replace(/(\w+)\+\+/g, "$1 = $1 + 1");
      const interpreter = new InterpretarVisitor();
      parse(adapted).forEach((statement: { accept(visitor: unknown): void }) => statement.accept(interpreter));
      return { stdout: String(interpreter.consola).trim(), errors: interpreter.errores.listaErrores.length };
    };
  } catch {
    return null; // not a git checkout, or the old commit is not there: the column says so
  }
}
const legacy = await loadLegacy();

function timeLegacy(source: string, expected: string): number | null {
  if (legacy === null) return null;
  try {
    const start = performance.now();
    const result = legacy(source);
    const ms = performance.now() - start;
    return result.errors === 0 && result.stdout === expected ? ms : null; // it could not run this program (older syntax) or printed something else
  } catch {
    return null;
  }
}

const dir = join(root, "bench");
const files = readdirSync(dir).filter((f) => f.endsWith(".oak")).sort();

const cpu = cpus()[0]?.model.replace(/\s+/g, " ").trim() ?? "unknown CPU";
console.log(`Node ${process.version} on ${cpu} (${cpus().length} threads, ${Math.round(totalmem() / 2 ** 30)} GiB), ${platform()} ${release()}; median of ${RUNS} runs after one warm-up\n`);
console.log("| Program | Original (ms) | Interpreter, with trace (ms) | Interpreter, no trace (ms) | Compiled (ms) | Faster than the interpreter | Compile (ms) | Module (bytes) | Steps | Output |");
console.log("|---|---:|---:|---:|---:|---:|---:|---:|---:|---|");
for (const file of files) {
  const source = readFileSync(join(dir, file), "utf8");
  timeInterpreter(source, false); // warm-up: the engine compiles the interpreter's hot paths
  timeCompiled(source);
  const withTrace: number[] = [];
  const without: number[] = [];
  const compiledRuns: number[] = [];
  const compileTimes: number[] = [];
  let sample = { stdout: "", steps: 0 };
  let bytes = 0;
  for (let i = 0; i < RUNS; i++) {
    withTrace.push(timeInterpreter(source, true).ms);
    const plain = timeInterpreter(source, false);
    without.push(plain.ms);
    sample = plain;
    const compiled = timeCompiled(source);
    if (compiled.stdout !== plain.stdout) throw new Error(`${file}: the compiled program printed "${compiled.stdout}" and the interpreter "${plain.stdout}"`);
    compiledRuns.push(compiled.runMs);
    compileTimes.push(compiled.compileMs);
    bytes = compiled.bytes;
  }
  const original = timeLegacy(source, sample.stdout);
  const interpreted = median(without);
  const compiledMs = median(compiledRuns);
  console.log(
    `| ${file.replace(".oak", "")} | ${original === null ? "n/a" : original.toFixed(0)} | ${median(withTrace).toFixed(0)} | ${interpreted.toFixed(0)} | ${compiledMs.toFixed(1)} | ${(interpreted / compiledMs).toFixed(0)}× | ${median(compileTimes).toFixed(1)} | ${bytes.toLocaleString("en-US")} | ${sample.steps.toLocaleString("en-US")} | ${sample.stdout.replace(/\|/g, "\\|")} |`,
  );
}
console.log("\n`n/a` in the Original column: the original interpreter cannot run that program (older syntax, no classes) or printed something else.");
