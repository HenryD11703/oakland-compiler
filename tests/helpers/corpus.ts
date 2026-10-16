import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CLASS_MISTAKES } from "./class-mistakes";

const root = join(import.meta.dirname, "..", "..");

export interface CorpusProgram {
  readonly name: string;
  readonly source: string;
}

/** The programs of docs/LANGUAGE.md: every ```oak block. */
function languageExamples(): CorpusProgram[] {
  const lines = readFileSync(join(root, "docs", "LANGUAGE.md"), "utf8").split(/\r?\n/);
  const found: CorpusProgram[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^```oak\s*$/.test(lines[i] as string)) continue;
    const start = i + 1;
    const body: string[] = [];
    i++;
    while (i < lines.length && !/^```\s*$/.test(lines[i] as string)) body.push(lines[i++] as string);
    found.push({ name: `LANGUAGE.md line ${start}`, source: body.join("\n") });
  }
  return found;
}

/** Every program the project owns: the examples, the seven samples, the documented ones and the mistake catalogue. */
export function corpus(): CorpusProgram[] {
  const files = (dir: string): CorpusProgram[] =>
    readdirSync(dir)
      .sort()
      .filter((file) => /\.(oak|txt)$/.test(file))
      .map((file) => ({ name: `${dir.split(/[\\/]/).slice(-1)[0]}/${file}`, source: readFileSync(join(dir, file), "utf8") }));
  return [
    ...files(join(root, "src", "examples")),
    ...files(join(root, "tests", "fixtures", "prueba")),
    ...languageExamples(),
    ...CLASS_MISTAKES.map(([name, source]) => ({ name: `class mistake: ${name}`, source })),
  ];
}
