// Times the interpreter and the compiler inside a real browser (Chromium, through Playwright). Run with `npm run bench:browser`.
// Usage: npm run bench:browser [-- --runs 5]
//
// The core is bundled into one script, loaded into an empty page, and each program in bench/ is timed there with
// performance.now(), the way the site's Worker would run it (same engine, no page around it). Needs Chromium:
// `npx playwright install chromium`.
import { build } from "vite";
import { chromium } from "@playwright/test";
import { readdirSync, readFileSync } from "node:fs";
import { cpus, platform, release, totalmem } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const runsArg = process.argv.indexOf("--runs");
const RUNS = runsArg > 0 ? Number(process.argv[runsArg + 1]) : 5;

const built = await build({
  root,
  logLevel: "error",
  configFile: false,
  build: { write: false, minify: true, lib: { entry: join(root, "src", "core", "index.ts"), name: "Oak", formats: ["iife"], fileName: "core" } },
});
const output = (Array.isArray(built) ? built[0] : built) as { output: { type: string; code?: string }[] };
const script = output.output.find((chunk) => chunk.type === "chunk")?.code ?? "";
if (script === "") throw new Error("the core could not be bundled for the browser");

const dir = join(root, "bench");
const programs = readdirSync(dir)
  .filter((f) => f.endsWith(".oak"))
  .sort()
  .map((f) => ({ name: f.replace(".oak", ""), source: readFileSync(join(dir, f), "utf8") }));

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent("<!doctype html><title>bench</title>");
// tsx adds a `__name` helper to the functions it compiles, and the harness below is sent to the page as one; the core is not.
await page.addScriptTag({ content: "window.__name = (f) => f;" });
await page.addScriptTag({ content: script });

interface Row {
  name: string;
  interpreted: number;
  compiled: number;
  compile: number;
  bytes: number;
  same: boolean;
}

const rows: Row[] = await page.evaluate(
  ({ programs, RUNS }) => {
    const Oak = (window as unknown as { Oak: typeof import("../src/core/index") }).Oak;
    const limits = { maxSteps: 2_000_000_000, maxTimeMs: 300_000 };
    const median = (values: number[]): number => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
    return programs.map(({ name, source }) => {
      const interpreted: number[] = [];
      const compiled: number[] = [];
      const compiling: number[] = [];
      let text = "";
      let other = "";
      let bytes = 0;
      for (let i = -1; i < RUNS; i++) {
        // the first round is the warm-up
        let t = performance.now();
        const interpretation = Oak.run(source, { trace: false, limits });
        const a = performance.now() - t;
        t = performance.now();
        const result = Oak.compile(source);
        const b = performance.now() - t;
        t = performance.now();
        const ran = Oak.runCompiled(result);
        const c = performance.now() - t;
        text = interpretation.stdout.trim();
        other = ran.stdout.trim();
        bytes = result.wasm?.length ?? 0;
        if (i >= 0) {
          interpreted.push(a);
          compiling.push(b);
          compiled.push(c);
        }
      }
      return { name, interpreted: median(interpreted), compiled: median(compiled), compile: median(compiling), bytes, same: text === other };
    });
  },
  { programs, RUNS },
);
const version = browser.version();
await browser.close();

const cpu = cpus()[0]?.model.replace(/\s+/g, " ").trim() ?? "unknown CPU";
console.log(`Chromium ${version} (headless, through Playwright) on ${cpu} (${cpus().length} threads, ${Math.round(totalmem() / 2 ** 30)} GiB), ${platform()} ${release()}; median of ${RUNS} runs after one warm-up\n`);
console.log("| Program | Interpreter, no trace (ms) | Compiled (ms) | Faster than the interpreter | Compile (ms) | Module (bytes) |");
console.log("|---|---:|---:|---:|---:|---:|");
for (const r of rows) {
  if (!r.same) throw new Error(`${r.name}: the two modes printed different text in the browser`);
  console.log(`| ${r.name} | ${r.interpreted.toFixed(0)} | ${r.compiled.toFixed(1)} | ${(r.interpreted / r.compiled).toFixed(0)}× | ${r.compile.toFixed(1)} | ${r.bytes.toLocaleString("en-US")} |`);
}
