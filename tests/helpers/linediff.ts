/**
 * A small line diff (longest common subsequence): lines only in `before` are marked `-`, lines only in `after`
 * are marked `+`, and unchanged runs are collapsed. Enough to review how an output changed.
 */
export function lineDiff(before: readonly string[], after: readonly string[]): string[] {
  const n = before.length;
  const m = after.length;
  const common: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      common[i]![j] = before[i] === after[j] ? common[i + 1]![j + 1]! + 1 : Math.max(common[i + 1]![j]!, common[i]![j + 1]!);
    }
  }
  const result: string[] = [];
  let unchanged = 0;
  const flush = (): void => {
    if (unchanged > 0) result.push(`  ... ${unchanged} unchanged line${unchanged === 1 ? "" : "s"}`);
    unchanged = 0;
  };
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && before[i] === after[j]) {
      unchanged++;
      i++;
      j++;
    } else if (j < m && (i >= n || common[i]![j + 1]! >= common[i + 1]![j]!)) {
      flush();
      result.push(`+ ${after[j]}`);
      j++;
    } else {
      flush();
      result.push(`- ${before[i]}`);
      i++;
    }
  }
  flush();
  return result;
}
