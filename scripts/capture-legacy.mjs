// Runs the ORIGINAL OakLand interpreter (git commit 11b0e46) on every sample program and stores
// what it printed and which errors it reported. The new interpreter is compared against these files.
//
//   node scripts/capture-legacy.mjs
//
// Output: tests/golden/legacy/<name>.stdout.txt and <name>.diagnostics.json
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, parse as parsePath, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const LEGACY_COMMIT = "11b0e46";
const root = resolve(import.meta.dirname, "..");
const fixturesDir = join(root, "tests", "fixtures", "prueba");
const outDir = join(root, "tests", "golden", "legacy");

// time() reads the clock; freeze it so the capture is reproducible.
const FIXED_NOW = Date.parse("2024-09-20T12:00:00.000Z");
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...args) {
    super(...(args.length ? args : [FIXED_NOW]));
  }
  static now() {
    return FIXED_NOW;
  }
};

const work = mkdtempSync(join(tmpdir(), "oakland-legacy-"));
try {
  // Copy the interpreter's files out of git (no tar: Git Bash's tar misreads "C:" paths).
  const src = join(work, "src");
  mkdirSync(src);
  const git = (...args) => execFileSync("git", args, { cwd: root, maxBuffer: 64 * 1024 * 1024 });
  const wanted = git("ls-tree", "-r", "--name-only", LEGACY_COMMIT)
    .toString()
    .split("\n")
    .filter((path) => path === "nodos.js" || path === "visitor.js" || (path.startsWith("Interpreter/") && path.endsWith(".js")));
  for (const path of wanted) {
    mkdirSync(join(src, parsePath(path).dir), { recursive: true });
    writeFileSync(join(src, path), git("show", `${LEGACY_COMMIT}:${path}`));
  }
  writeFileSync(join(src, "package.json"), '{"type":"module"}\n');

  const { parse } = await import(pathToFileURL(join(src, "Interpreter", "gramatica.js")).href);
  const { InterpretarVisitor } = await import(pathToFileURL(join(src, "Interpreter", "Interprete.js")).href);

  mkdirSync(outDir, { recursive: true });
  for (const file of readdirSync(fixturesDir).sort()) {
    const name = parsePath(file).name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const source = readFileSync(join(fixturesDir, file), "utf8");
    let stdout = "";
    let diagnostics = [];
    let hostError = null;
    try {
      const interpreter = new InterpretarVisitor();
      parse(source).forEach((statement) => statement.accept(interpreter));
      stdout = interpreter.consola;
      diagnostics = interpreter.errores.listaErrores;
    } catch (error) {
      hostError = `${error.name}: ${error.message}`;
    }
    writeFileSync(join(outDir, `${name}.stdout.txt`), stdout);
    writeFileSync(join(outDir, `${name}.diagnostics.json`), JSON.stringify({ source: file, hostError, diagnostics }, null, 2) + "\n");
    console.log(`${file} -> ${name}: ${stdout.split("\n").length - 1} lines, ${diagnostics.length} diagnostics${hostError ? ", HOST ERROR " + hostError : ""}`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
