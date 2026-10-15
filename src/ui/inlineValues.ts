import type { AstNode } from "../core/astView";

/**
 * The variables each line of the source assigns or declares, found in the syntax tree, so that the editor can
 * show their current values at the end of those lines. Keys are 1-based line numbers.
 */
export function assignedNames(ast: AstNode): Map<number, string[]> {
  const byLine = new Map<number, string[]>();
  const add = (line: number, name: string): void => {
    const names = byLine.get(line) ?? [];
    if (!names.includes(name)) names.push(name);
    byLine.set(line, names);
  };
  const walk = (node: AstNode): void => {
    if (node.kind === "VarDecl") {
      // label is "type name"
      const name = node.label.split(" ").at(-1);
      if (name) add(node.span.start.line, name);
    } else if ((node.kind === "Assign" || node.kind === "Update") && node.children[0]?.kind === "Identifier") {
      add(node.span.start.line, node.children[0].label);
    }
    node.children.forEach(walk);
  };
  walk(ast);
  return byLine;
}
