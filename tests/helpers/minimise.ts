/**
 * Makes a failing program small (task T53). `fails` says whether a candidate still shows the failure (and is still a
 * valid program: a candidate that does not compile does not fail). The program is cut by lines, in chunks that start
 * as half of it and get smaller, keeping every cut that still fails (delta debugging).
 */
export function minimise(source: string, fails: (candidate: string) => boolean): string {
  let lines = source.split("\n");
  let chunk = Math.max(1, Math.floor(lines.length / 2));
  while (chunk >= 1) {
    let removed = false;
    for (let start = 0; start < lines.length; ) {
      const candidate = [...lines.slice(0, start), ...lines.slice(start + chunk)];
      if (candidate.length > 0 && fails(candidate.join("\n"))) {
        lines = candidate;
        removed = true;
      } else {
        start += chunk;
      }
    }
    if (!removed) chunk = Math.floor(chunk / 2);
  }
  return lines.join("\n");
}
