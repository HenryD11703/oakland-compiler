import { diagnostic, type Diagnostic } from "../diagnostics";
import type { Program, Statement } from "../parser/ast";

interface Context {
  readonly inLoop: boolean;
  readonly inSwitch: boolean;
  readonly inFunction: boolean;
}

/**
 * Finds `break`, `continue` and `return` in places where they mean nothing (AC-12). This needs no running,
 * so every misplaced one is reported, including those in code that never executes.
 */
export function checkPlacement(program: Program): Diagnostic[] {
  const found: Diagnostic[] = [];

  const visit = (statement: Statement, context: Context): void => {
    switch (statement.kind) {
      case "Break":
        if (!context.inLoop && !context.inSwitch) {
          found.push(diagnostic("semantic", "'break' is only allowed inside a loop or a switch", statement.span));
        }
        return;
      case "Continue":
        if (!context.inLoop) {
          found.push(diagnostic("semantic", "'continue' is only allowed inside a loop", statement.span));
        }
        return;
      case "Return":
        if (!context.inFunction) {
          found.push(diagnostic("semantic", "'return' is only allowed inside a function", statement.span));
        }
        return;
      case "Block":
        statement.body.forEach((child) => visit(child, context));
        return;
      case "If":
        visit(statement.then, context);
        if (statement.otherwise) visit(statement.otherwise, context);
        return;
      case "While":
      case "For":
      case "Foreach":
        visit(statement.body, { ...context, inLoop: true });
        return;
      case "Switch":
        for (const branch of statement.cases) branch.body.forEach((child) => visit(child, { ...context, inSwitch: true }));
        if (statement.default) statement.default.body.forEach((child) => visit(child, { ...context, inSwitch: true }));
        return;
      case "FuncDecl":
        statement.body.body.forEach((child) => visit(child, { inLoop: false, inSwitch: false, inFunction: true }));
        return;
      default:
        return;
    }
  };

  program.body.forEach((statement) => visit(statement, { inLoop: false, inSwitch: false, inFunction: false }));
  return found;
}
