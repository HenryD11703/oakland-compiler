import { compareDiagnostics, diagnostic, type Diagnostic } from "../diagnostics";
import { tokenize } from "../lexer/lexer";
import { describeToken, isKeyword, isPunct, PRIMITIVE_TYPES, type Token } from "../lexer/tokens";
import { endOf, joinSpans, type Span } from "../span";
import type {
  ArrayLiteral,
  AssignOp,
  BinaryOp,
  Block,
  Expression,
  FieldDecl,
  FieldInit,
  FuncDecl,
  Initializer,
  LValue,
  Param,
  Program,
  Statement,
  StructDecl,
  SwitchCase,
  SwitchDefault,
  TypeRef,
  Update,
  VarDecl,
} from "./ast";

/** The parser reports at most this many syntax errors per run (AC-21). */
export const MAX_SYNTAX_ERRORS = 10;

export interface ParseResult {
  readonly program: Program;
  /** Lexical and syntax problems, sorted by position. If it is not empty the program must not run. */
  readonly diagnostics: Diagnostic[];
  /** The tokens without comments, ending with `eof`. */
  readonly tokens: Token[];
  /** True when more than MAX_SYNTAX_ERRORS errors were found and parsing stopped early. */
  readonly truncated: boolean;
}

class SyntaxFailure extends Error {
  constructor(readonly diag: Diagnostic) {
    super(diag.message);
  }
}

const BINARY_PRECEDENCE: Readonly<Record<string, number>> = {
  "||": 1,
  "&&": 2,
  "==": 3,
  "!=": 3,
  "<": 4,
  "<=": 4,
  ">": 4,
  ">=": 4,
  "+": 5,
  "-": 5,
  "*": 6,
  "/": 6,
  "%": 6,
};

/** After a syntax error the parser skips ahead to a `;`, a `}` or one of these words. */
const RESYNC_KEYWORDS: ReadonlySet<string> = new Set([
  "if", "while", "for", "switch", "return", "break", "continue", "struct", "case", "default",
  "int", "float", "string", "boolean", "char", "var", "void",
]);

const UPDATE_MESSAGE = "'++' and '--' can only be used as a statement or in the update part of a for loop";

export function parse(source: string): ParseResult {
  const lexed = tokenize(source);
  const parser = new Parser(lexed.tokens);
  const program = parser.parseProgram();

  // A lexical error usually causes follow-up syntax errors on the same line; keep only the first cause.
  const lexicalLines = new Set(lexed.diagnostics.map((d) => d.span.start.line));
  const syntax = parser.diagnostics.filter((d) => !lexicalLines.has(d.span.start.line));
  const diagnostics = [...lexed.diagnostics, ...syntax].sort(compareDiagnostics);
  return { program, diagnostics, tokens: lexed.tokens, truncated: parser.truncated };
}

class Parser {
  private pos = 0;
  private readonly syntaxDiagnostics: Diagnostic[] = [];
  private readonly structNames = new Set<string>();
  private stopped = false;
  truncated = false;

  constructor(private readonly tokens: readonly Token[]) {
    // Struct names are known before parsing so that `Person{...}` can be told apart from `x {`.
    for (let i = 0; i + 1 < tokens.length; i++) {
      const t = tokens[i] as Token;
      const next = tokens[i + 1] as Token;
      if (isKeyword(t, "struct") && next.type === "identifier") this.structNames.add(next.text);
    }
  }

  get diagnostics(): Diagnostic[] {
    return this.syntaxDiagnostics;
  }

  // ---------- token helpers ----------

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)] as Token;
  }

  private previous(): Token {
    return this.tokens[Math.max(0, this.pos - 1)] as Token;
  }

  private advance(): Token {
    const token = this.peek();
    if (token.type !== "eof") this.pos++;
    return token;
  }

  private atEof(): boolean {
    return this.peek().type === "eof";
  }

  private atPunct(text: string, offset = 0): boolean {
    return isPunct(this.peek(offset), text);
  }

  private atKeyword(text: string): boolean {
    return isKeyword(this.peek(), text);
  }

  private matchPunct(text: string): Token | null {
    return this.atPunct(text) ? this.advance() : null;
  }

  // ---------- errors ----------

  private failAt(span: Span, message: string): never {
    throw new SyntaxFailure(diagnostic("syntax", message, span));
  }

  /** Something is missing: point just after the last good token. */
  private failMissing(message: string): never {
    const span = this.pos === 0 ? this.peek().span : endOf(this.previous().span);
    this.failAt(span, message);
  }

  private expectPunct(text: string, context: string): Token {
    if (this.atPunct(text)) return this.advance();
    return this.failMissing(`expected '${text}' ${context}`);
  }

  private expectName(context: string): Token {
    const token = this.peek();
    if (token.type === "identifier") return this.advance();
    if (token.type === "keyword") {
      this.failAt(token.span, `'${token.text}' is a reserved word and cannot be used as a name`);
    }
    return this.failAt(token.span, `expected a name ${context}, but found ${describeToken(token)}`);
  }

  private record(error: unknown): void {
    if (!(error instanceof SyntaxFailure)) throw error;
    if (this.stopped) return;
    if (this.syntaxDiagnostics.length >= MAX_SYNTAX_ERRORS) {
      this.stopped = true;
      this.truncated = true;
      return;
    }
    this.syntaxDiagnostics.push(error.diag);
  }

  /** Skip to the end of the broken statement. Always makes progress. */
  private recover(error: unknown, statementStart: number): void {
    this.record(error);
    if (this.pos === statementStart && !this.atEof()) this.advance();
    while (!this.atEof()) {
      if (isPunct(this.previous(), ";") && this.pos > statementStart) return;
      const token = this.peek();
      if (isPunct(token, "}")) return;
      if (token.type === "keyword" && RESYNC_KEYWORDS.has(token.text) && this.pos > statementStart) return;
      this.advance();
    }
  }

  // ---------- program, blocks, declarations ----------

  parseProgram(): Program {
    const first = this.peek();
    const body: Statement[] = [];
    while (!this.atEof() && !this.stopped) {
      const start = this.pos;
      try {
        body.push(this.parseDeclaration());
      } catch (error) {
        this.recover(error, start);
      }
    }
    const last = this.previous();
    return { kind: "Program", body, span: joinSpans(first.span, this.pos === 0 ? first.span : last.span) };
  }

  private parseStatements(isEnd: () => boolean): Statement[] {
    const statements: Statement[] = [];
    while (!this.atEof() && !isEnd() && !this.stopped) {
      const start = this.pos;
      try {
        statements.push(this.parseDeclaration());
      } catch (error) {
        this.recover(error, start);
      }
    }
    return statements;
  }

  private parseBlock(): Block {
    const open = this.expectPunct("{", "to start the block");
    const body = this.parseStatements(() => this.atPunct("}"));
    if (!this.atPunct("}")) {
      this.failMissing(`expected '}' to close the block opened on line ${open.span.start.line}`);
    }
    const close = this.advance();
    return { kind: "Block", body, span: joinSpans(open.span, close.span) };
  }

  private parseDeclaration(): Statement {
    const token = this.peek();
    if (isPunct(token, "}")) this.failAt(token.span, "unexpected '}': there is no open block to close");
    if (isKeyword(token, "struct")) return this.parseStruct();
    if (this.isTypeStart()) return this.parseTypedDeclaration();
    return this.parseStatement();
  }

  /** True when the next tokens begin a declaration: `int x`, `var x`, `void f`, `Person p`, `Person[] p`. */
  private isTypeStart(): boolean {
    const token = this.peek();
    if (token.type === "keyword") {
      return PRIMITIVE_TYPES.has(token.text) || token.text === "var" || token.text === "void";
    }
    if (token.type === "identifier") {
      const next = this.peek(1);
      if (next.type === "identifier") return true;
      if (isPunct(next, "[") && isPunct(this.peek(2), "]")) return true;
    }
    return false;
  }

  private parseType(): TypeRef {
    const first = this.advance();
    let end = first.span;
    let dims = 0;
    while (this.atPunct("[") && this.atPunct("]", 1)) {
      this.advance();
      end = this.advance().span;
      dims++;
    }
    return { kind: "TypeRef", name: first.text, dims, span: joinSpans(first.span, end) };
  }

  private parseTypedDeclaration(): VarDecl | FuncDecl {
    const first = this.peek();

    if (isKeyword(first, "var")) {
      this.advance();
      const name = this.expectName("after 'var'");
      if (!this.matchPunct("=")) this.failMissing("'var' needs an initial value, for example: var x = 5;");
      const init = this.parseExpression();
      const semicolon = this.expectPunct(";", "after the declaration");
      return {
        kind: "VarDecl",
        declaredType: null,
        name: name.text,
        nameSpan: name.span,
        init,
        span: joinSpans(first.span, semicolon.span),
      };
    }

    const type = this.parseType();
    const name = this.expectName("after the type");

    if (this.atPunct("(")) return this.parseFunction(type, name);

    if (type.name === "void") this.failAt(type.span, "a variable cannot have the type 'void'");
    const init = this.matchPunct("=") ? this.parseInitializer() : null;
    const semicolon = this.expectPunct(";", "after the declaration");
    return {
      kind: "VarDecl",
      declaredType: type,
      name: name.text,
      nameSpan: name.span,
      init,
      span: joinSpans(type.span, semicolon.span),
    };
  }

  private parseFunction(returnType: TypeRef, name: Token): FuncDecl {
    this.advance(); // (
    const params: Param[] = [];
    if (!this.atPunct(")")) {
      do {
        const token = this.peek();
        const isType = (token.type === "keyword" && PRIMITIVE_TYPES.has(token.text)) || token.type === "identifier";
        if (!isType) this.failAt(token.span, `expected a parameter type, but found ${describeToken(token)}`);
        const type = this.parseType();
        const paramName = this.expectName("for the parameter");
        params.push({ type, name: paramName.text, nameSpan: paramName.span });
      } while (this.matchPunct(","));
    }
    this.expectPunct(")", "to close the parameter list");
    if (!this.atPunct("{")) this.failMissing(`expected '{' to start the body of '${name.text}'`);
    const body = this.parseBlock();
    return {
      kind: "FuncDecl",
      returnType,
      name: name.text,
      nameSpan: name.span,
      params,
      body,
      span: joinSpans(returnType.span, body.span),
    };
  }

  private parseStruct(): StructDecl {
    const keyword = this.advance();
    const name = this.expectName("after 'struct'");
    this.expectPunct("{", "to start the struct body");
    const fields: FieldDecl[] = [];
    while (!this.atPunct("}") && !this.atEof()) {
      const token = this.peek();
      const isType = (token.type === "keyword" && PRIMITIVE_TYPES.has(token.text)) || token.type === "identifier";
      if (!isType) this.failAt(token.span, `expected a field like 'int age;', but found ${describeToken(token)}`);
      const type = this.parseType();
      const fieldName = this.expectName("for the field");
      this.expectPunct(";", "after the field");
      fields.push({ type, name: fieldName.text, nameSpan: fieldName.span });
    }
    const close = this.expectPunct("}", `to close the struct '${name.text}'`);
    const end = this.matchPunct(";") ?? close;
    return { kind: "StructDecl", name: name.text, nameSpan: name.span, fields, span: joinSpans(keyword.span, end.span) };
  }

  private parseInitializer(): Initializer {
    return this.atPunct("{") ? this.parseArrayLiteral() : this.parseExpression();
  }

  private parseArrayLiteral(): ArrayLiteral {
    const open = this.advance();
    const elements: Initializer[] = [];
    if (!this.atPunct("}")) {
      do {
        elements.push(this.parseInitializer());
      } while (this.matchPunct(","));
    }
    const close = this.expectPunct("}", "to close the list of values");
    return { kind: "ArrayLiteral", elements, span: joinSpans(open.span, close.span) };
  }

  // ---------- statements ----------

  /** The body of `if`, `else`, `while` and `for`: any statement except a declaration. */
  private parseBody(): Statement {
    const token = this.peek();
    if (this.isTypeStart() || isKeyword(token, "struct")) {
      this.failAt(token.span, "a declaration is not allowed here; put it inside { }");
    }
    return this.parseStatement();
  }

  private parseStatement(): Statement {
    const token = this.peek();
    if (isPunct(token, "{")) return this.parseBlock();

    if (token.type === "keyword") {
      switch (token.text) {
        case "if":
          return this.parseIf();
        case "while":
          return this.parseWhile();
        case "for":
          return this.parseFor();
        case "switch":
          return this.parseSwitch();
        case "return":
          return this.parseReturn();
        case "break":
        case "continue": {
          this.advance();
          const semicolon = this.expectPunct(";", `after '${token.text}'`);
          return { kind: token.text === "break" ? "Break" : "Continue", span: joinSpans(token.span, semicolon.span) };
        }
        case "else":
          return this.failAt(token.span, "'else' without a matching 'if'");
        case "case":
        case "default":
          return this.failAt(token.span, `'${token.text}' can only be used inside a switch`);
      }
    }

    if (this.atPrint()) return this.parsePrint();
    return this.parseSimpleStatement();
  }

  private atPrint(): boolean {
    const [system, dot1, out, dot2, println, open] = [0, 1, 2, 3, 4, 5].map((i) => this.peek(i));
    return (
      system?.text === "System" && system.type === "identifier" &&
      isPunct(dot1 as Token, ".") &&
      out?.text === "out" && out.type === "identifier" &&
      isPunct(dot2 as Token, ".") &&
      println?.text === "println" && println.type === "identifier" &&
      isPunct(open as Token, "(")
    );
  }

  private parsePrint(): Statement {
    const first = this.peek();
    for (let i = 0; i < 6; i++) this.advance(); // System . out . println (
    const args: Expression[] = [];
    if (!this.atPunct(")")) {
      do {
        args.push(this.parseExpression());
      } while (this.matchPunct(","));
    }
    this.expectPunct(")", "to close System.out.println(");
    const semicolon = this.expectPunct(";", "after the statement");
    return { kind: "Print", args, span: joinSpans(first.span, semicolon.span) };
  }

  /** `i++;`, an assignment, a call, or any other expression followed by `;`. */
  private parseSimpleStatement(): Statement {
    const first = this.peek();
    const update = this.tryUpdate();
    if (update) {
      const semicolon = this.expectPunct(";", "after the statement");
      return { ...update, span: joinSpans(first.span, semicolon.span) };
    }
    const expression = this.parseExpression();
    const semicolon = this.expectPunct(";", "after the expression");
    return { kind: "ExprStmt", expression, span: joinSpans(first.span, semicolon.span) };
  }

  /** Recognises `target++` / `target--`; leaves the position untouched when it is something else. */
  private tryUpdate(): Update | null {
    const start = this.pos;
    let target: Expression;
    try {
      target = this.parsePostfix(true);
    } catch (error) {
      if (!(error instanceof SyntaxFailure)) throw error;
      // Not an update; let the normal expression parser report whatever is wrong.
      this.pos = start;
      return null;
    }
    const operator = this.peek();
    if (!isPunct(operator, "++") && !isPunct(operator, "--")) {
      this.pos = start;
      return null;
    }
    if (!isLValue(target)) {
      this.failAt(target.span, `'${operator.text}' needs a variable, an array element or a struct field`);
    }
    this.advance();
    return { kind: "Update", op: operator.text as "++" | "--", target, span: joinSpans(target.span, operator.span) };
  }

  private parseIf(): Statement {
    const keyword = this.advance();
    this.expectPunct("(", "after 'if'");
    const condition = this.parseExpression();
    this.expectPunct(")", "after the condition");
    const then = this.parseBody();
    let otherwise: Statement | null = null;
    if (this.atKeyword("else")) {
      this.advance();
      otherwise = this.atKeyword("if") ? this.parseIf() : this.parseBody();
    }
    return { kind: "If", condition, then, otherwise, span: joinSpans(keyword.span, (otherwise ?? then).span) };
  }

  private parseWhile(): Statement {
    const keyword = this.advance();
    this.expectPunct("(", "after 'while'");
    const condition = this.parseExpression();
    this.expectPunct(")", "after the condition");
    const body = this.parseBody();
    return { kind: "While", condition, body, span: joinSpans(keyword.span, body.span) };
  }

  private parseFor(): Statement {
    const keyword = this.advance();
    this.expectPunct("(", "after 'for'");

    const foreach = this.tryForeachHeader();
    if (foreach) {
      const iterable = this.parseExpression();
      this.expectPunct(")", "to close the for header");
      const body = this.parseBody();
      return {
        kind: "Foreach",
        varType: foreach.varType,
        name: foreach.name.text,
        nameSpan: foreach.name.span,
        iterable,
        body,
        span: joinSpans(keyword.span, body.span),
      };
    }

    let init: VarDecl | { kind: "ExprStmt"; expression: Expression; span: Span } | null = null;
    if (this.atPunct(";")) {
      this.advance();
    } else if (this.isTypeStart()) {
      const declaration = this.parseTypedDeclaration();
      if (declaration.kind !== "VarDecl") this.failAt(declaration.span, "a function cannot be declared here");
      init = declaration;
    } else {
      const expression = this.parseExpression();
      const semicolon = this.expectPunct(";", "after the loop initialisation");
      init = { kind: "ExprStmt", expression, span: joinSpans(expression.span, semicolon.span) };
    }

    const condition = this.parseExpression();
    this.expectPunct(";", "after the loop condition");
    const update = this.tryUpdate() ?? this.parseExpression();
    this.expectPunct(")", "to close the for header");
    const body = this.parseBody();
    return { kind: "For", init, condition, update, body, span: joinSpans(keyword.span, body.span) };
  }

  /** Recognises `int v :` or `var v :` at the start of a for header; otherwise leaves the position untouched. */
  private tryForeachHeader(): { varType: TypeRef | null; name: Token } | null {
    const start = this.pos;
    try {
      const token = this.peek();
      let varType: TypeRef | null = null;
      if (isKeyword(token, "var")) {
        this.advance();
      } else if ((token.type === "keyword" && PRIMITIVE_TYPES.has(token.text)) || token.type === "identifier") {
        varType = this.parseType();
      } else {
        this.pos = start;
        return null;
      }
      const name = this.peek();
      if (name.type === "identifier" && isPunct(this.peek(1), ":")) {
        this.advance();
        this.advance();
        return { varType, name };
      }
    } catch (error) {
      if (!(error instanceof SyntaxFailure)) throw error;
    }
    this.pos = start;
    return null;
  }

  private parseSwitch(): Statement {
    const keyword = this.advance();
    this.expectPunct("(", "after 'switch'");
    const discriminant = this.parseExpression();
    this.expectPunct(")", "after the switch value");
    this.expectPunct("{", "to start the switch body");

    const isCaseEnd = (): boolean => this.atKeyword("case") || this.atKeyword("default") || this.atPunct("}");
    const cases: SwitchCase[] = [];
    let defaultCase: SwitchDefault | null = null;

    while (!this.atPunct("}") && !this.atEof() && !this.stopped) {
      const label = this.peek();
      if (isKeyword(label, "case")) {
        if (defaultCase) this.failAt(label.span, "'default' must be the last part of a switch");
        this.advance();
        const test = this.parseExpression();
        const colon = this.expectPunct(":", "after the case value");
        const body = this.parseStatements(isCaseEnd);
        const end = body.length > 0 ? (body[body.length - 1] as Statement).span : colon.span;
        cases.push({ test, body, span: joinSpans(label.span, end) });
      } else if (isKeyword(label, "default")) {
        if (defaultCase) this.failAt(label.span, "a switch can only have one 'default'");
        this.advance();
        const colon = this.expectPunct(":", "after 'default'");
        const body = this.parseStatements(isCaseEnd);
        const end = body.length > 0 ? (body[body.length - 1] as Statement).span : colon.span;
        defaultCase = { body, span: joinSpans(label.span, end) };
      } else {
        this.failAt(label.span, `expected 'case' or 'default', but found ${describeToken(label)}`);
      }
    }
    const close = this.expectPunct("}", "to close the switch");
    return { kind: "Switch", discriminant, cases, default: defaultCase, span: joinSpans(keyword.span, close.span) };
  }

  private parseReturn(): Statement {
    const keyword = this.advance();
    const value = this.atPunct(";") ? null : this.parseExpression();
    const semicolon = this.expectPunct(";", "after return");
    return { kind: "Return", value, span: joinSpans(keyword.span, semicolon.span) };
  }

  // ---------- expressions ----------

  private parseExpression(): Expression {
    return this.parseAssignment();
  }

  private parseAssignment(): Expression {
    const left = this.parseTernary();
    const operator = this.peek();
    if (isPunct(operator, "=") || isPunct(operator, "+=") || isPunct(operator, "-=")) {
      if (!isLValue(left)) {
        this.failAt(left.span, "the left side of an assignment must be a variable, an array element or a struct field");
      }
      this.advance();
      const value = this.parseAssignment();
      return { kind: "Assign", op: operator.text as AssignOp, target: left, value, span: joinSpans(left.span, value.span) };
    }
    return left;
  }

  private parseTernary(): Expression {
    const condition = this.parseBinary(1);
    if (!this.matchPunct("?")) return condition;
    const whenTrue = this.parseExpression();
    this.expectPunct(":", "in the conditional expression (condition ? a : b)");
    const whenFalse = this.parseExpression();
    return { kind: "Ternary", condition, whenTrue, whenFalse, span: joinSpans(condition.span, whenFalse.span) };
  }

  private parseBinary(minPrecedence: number): Expression {
    let left = this.parseUnary();
    for (;;) {
      const operator = this.peek();
      const precedence = operator.type === "punct" ? BINARY_PRECEDENCE[operator.text] : undefined;
      if (precedence === undefined || precedence < minPrecedence) return left;
      this.advance();
      const right = this.parseBinary(precedence + 1);
      left = { kind: "Binary", op: operator.text as BinaryOp, left, right, span: joinSpans(left.span, right.span) };
    }
  }

  private parseUnary(): Expression {
    const token = this.peek();
    if (isPunct(token, "-") || isPunct(token, "!") || isKeyword(token, "typeof")) {
      this.advance();
      const operand = this.parseUnary();
      return {
        kind: "Unary",
        op: token.text as "-" | "!" | "typeof",
        operand,
        span: joinSpans(token.span, operand.span),
      };
    }
    return this.parsePostfix(false);
  }

  /** `allowUpdate` is true only where `++`/`--` may follow (statements and for updates). */
  private parsePostfix(allowUpdate: boolean): Expression {
    let expression = this.parsePrimary();
    for (;;) {
      if (this.atPunct("(")) {
        this.advance();
        const args: Expression[] = [];
        if (!this.atPunct(")")) {
          do {
            args.push(this.parseExpression());
          } while (this.matchPunct(","));
        }
        const close = this.expectPunct(")", "to close the call");
        expression = { kind: "Call", callee: expression, args, span: joinSpans(expression.span, close.span) };
      } else if (this.atPunct("[")) {
        this.advance();
        const index = this.parseExpression();
        const close = this.expectPunct("]", "to close the index");
        expression = { kind: "Index", target: expression, index, span: joinSpans(expression.span, close.span) };
      } else if (this.atPunct(".")) {
        this.advance();
        const name = this.expectName("after '.'");
        expression = {
          kind: "Member",
          object: expression,
          name: name.text,
          nameSpan: name.span,
          span: joinSpans(expression.span, name.span),
        };
      } else {
        break;
      }
    }
    const next = this.peek();
    if (!allowUpdate && (isPunct(next, "++") || isPunct(next, "--"))) this.failAt(next.span, UPDATE_MESSAGE);
    return expression;
  }

  private parsePrimary(): Expression {
    const token = this.peek();
    switch (token.type) {
      case "int":
        this.advance();
        return { kind: "Literal", literalType: "int", value: token.value as number, span: token.span };
      case "float":
        this.advance();
        return { kind: "Literal", literalType: "float", value: token.value as number, span: token.span };
      case "string":
        this.advance();
        return { kind: "Literal", literalType: "string", value: token.value as string, span: token.span };
      case "char":
        this.advance();
        return { kind: "Literal", literalType: "char", value: token.value as string, span: token.span };
      case "keyword":
        if (token.text === "true" || token.text === "false") {
          this.advance();
          return { kind: "Literal", literalType: "boolean", value: token.text === "true", span: token.span };
        }
        if (token.text === "null") {
          this.advance();
          return { kind: "Literal", literalType: "null", value: null, span: token.span };
        }
        if (token.text === "new") return this.parseNew();
        break;
      case "identifier":
        if (this.structNames.has(token.text) && this.atPunct("{", 1)) return this.parseStructLiteral();
        this.advance();
        return { kind: "Identifier", name: token.text, span: token.span };
      case "punct":
        if (token.text === "(") {
          this.advance();
          const expression = this.parseExpression();
          const close = this.expectPunct(")", "to close the parenthesis");
          return { kind: "Group", expression, span: joinSpans(token.span, close.span) };
        }
        break;
      case "eof":
        return this.failMissing("expected an expression");
    }
    // `x =` and then the next statement on a later line: the expression is missing, not the next line wrong.
    if (this.pos > 0 && token.span.start.line > this.previous().span.end.line) {
      return this.failMissing("expected an expression");
    }
    return this.failAt(token.span, `expected an expression, but found ${describeToken(token)}`);
  }

  private parseNew(): Expression {
    const keyword = this.advance();
    const type = this.peek();
    const isType = (type.type === "keyword" && PRIMITIVE_TYPES.has(type.text)) || type.type === "identifier";
    if (!isType) this.failAt(type.span, `expected a type after 'new', but found ${describeToken(type)}`);
    this.advance();
    if (!this.atPunct("[")) this.failMissing(`expected '[' with the array size after 'new ${type.text}'`);
    const sizes: Expression[] = [];
    let end = type.span;
    while (this.atPunct("[")) {
      this.advance();
      sizes.push(this.parseExpression());
      end = this.expectPunct("]", "to close the array size").span;
    }
    return { kind: "NewArray", elementType: type.text, sizes, span: joinSpans(keyword.span, end) };
  }

  private parseStructLiteral(): Expression {
    const name = this.advance();
    this.advance(); // {
    const fields: FieldInit[] = [];
    if (!this.atPunct("}")) {
      do {
        const fieldName = this.expectName("for the field");
        this.expectPunct(":", "after the field name");
        const value = this.parseExpression();
        fields.push({ name: fieldName.text, nameSpan: fieldName.span, value });
      } while (this.matchPunct(","));
    }
    const close = this.expectPunct("}", `to close the ${name.text} value`);
    return { kind: "StructLiteral", structName: name.text, fields, span: joinSpans(name.span, close.span) };
  }
}

function isLValue(expression: Expression): expression is LValue {
  return expression.kind === "Identifier" || expression.kind === "Index" || expression.kind === "Member";
}
