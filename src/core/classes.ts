import type { Access, ClassDecl, ClassField, CtorDecl, Expression, Initializer, MethodDecl, Statement } from "./parser/ast";
import type { Span } from "./span";
import { baseTypeOf, typeNameOf } from "./types";

/**
 * Classes as the interpreter and the type checker both know them. The rules that decide whether a class
 * declaration is acceptable live here, once, so that the two cannot disagree.
 */

/** A field of a class, with the class that declared it (a parent's field keeps its parent as owner). */
export interface FieldInfo {
  readonly name: string;
  readonly type: string;
  readonly access: Access;
  readonly owner: ClassInfo;
  readonly init: Initializer | null;
  readonly decl: ClassField;
}

export interface MethodInfo {
  readonly name: string;
  readonly decl: MethodDecl;
  readonly owner: ClassInfo;
  readonly access: Access;
}

export interface CtorInfo {
  readonly decl: CtorDecl;
  readonly owner: ClassInfo;
  readonly access: Access;
}

export interface ClassInfo {
  readonly kind: "class";
  readonly name: string;
  readonly decl: ClassDecl;
  /** The parent class, or null (also null when the declared parent was wrong: that was reported). */
  parent: ClassInfo | null;
  /** Every field an object has, the parent's first. */
  fields: FieldInfo[];
  /** Only the methods this class declares; use `ClassTable.findMethod` to include the inherited ones. */
  readonly methods: Map<string, MethodInfo>;
  readonly ctors: CtorInfo[];
  readonly declaredAt: Span;
  /** `new`: not looked at yet; `visiting`: being completed (a cycle if met again); `done`. */
  state: "new" | "visiting" | "done";
}

/** What the table needs from whoever uses it. */
export interface ClassHost {
  /** Puts the class name in the caller's scope. False if the name is already taken (the caller reports that). */
  register(info: ClassInfo): boolean;
  /** Can this type (with or without `[]`) be used in a declaration: a primitive, a struct or a class? */
  typeExists(type: string): boolean;
  isStruct(name: string): boolean;
  report(span: Span, message: string): void;
}

/** The first statement of a constructor body, if it is `super(...)`. */
export function superCallOf(body: readonly Statement[]): { readonly args: readonly Expression[]; readonly span: Span } | null {
  const first = body[0];
  return first?.kind === "ExprStmt" && first.expression.kind === "SuperCall" ? first.expression : null;
}

export function methodSignature(decl: Pick<MethodDecl, "returnType" | "params">): string {
  return `${typeNameOf(decl.returnType)}(${decl.params.map((p) => typeNameOf(p.type)).join(", ")})`;
}

export class ClassTable {
  readonly byName = new Map<string, ClassInfo>();

  constructor(private readonly host: ClassHost) {}

  get(name: string): ClassInfo | undefined {
    return this.byName.get(name);
  }

  /** Registers every class first, so that one may name another declared further down, then completes them. */
  declare(decls: readonly ClassDecl[]): ClassInfo[] {
    const added: ClassInfo[] = [];
    for (const decl of decls) {
      const info: ClassInfo = { kind: "class", name: decl.name, decl, parent: null, fields: [], methods: new Map(), ctors: [], declaredAt: decl.nameSpan, state: "new" };
      if (!this.host.register(info)) continue;
      this.byName.set(decl.name, info);
      added.push(info);
    }
    for (const info of added) this.complete(info);
    return added;
  }

  /** A method of the class or of one of its ancestors, the nearest first. */
  findMethod(cls: ClassInfo | null | undefined, name: string): MethodInfo | null {
    for (let current = cls ?? null; current !== null; current = current.parent) {
      const method = current.methods.get(name);
      if (method !== undefined) return method;
    }
    return null;
  }

  /** Is `from` the class `to` or one of its descendants? Both are class names. */
  isSubclass(from: string, to: string): boolean {
    for (let cls = this.byName.get(from) ?? null; cls !== null; cls = cls.parent) {
      if (cls.name === to) return true;
    }
    return false;
  }

  // ---------- completing a class ----------

  /** Checks a class against its parent and works out its fields and methods. A class is completed after its parent. */
  private complete(entry: ClassInfo): void {
    if (entry.state === "done") return;
    entry.state = "visiting";
    const decl = entry.decl;

    if (decl.superName !== null) {
      const parent = this.byName.get(decl.superName);
      const at = decl.superSpan ?? decl.nameSpan;
      if (parent === undefined) {
        this.host.report(at, this.host.isStruct(decl.superName) ? `'${decl.superName}' is a struct; a class can only extend a class` : `unknown class '${decl.superName}'`);
      } else if (parent.state === "visiting") {
        this.host.report(at, parent === entry ? `a class cannot extend itself ('${decl.name}')` : `'${decl.name}' extends '${parent.name}', which extends it back: a class cannot be its own ancestor`);
      } else {
        this.complete(parent);
        entry.parent = parent;
      }
    }

    const fields: FieldInfo[] = entry.parent ? [...entry.parent.fields] : [];
    const own = new Set<string>();
    for (const member of decl.members) {
      if (member.kind !== "ClassField") continue;
      const type = typeNameOf(member.type);
      if (own.has(member.name)) {
        this.host.report(member.nameSpan, `class '${decl.name}' already has a field named '${member.name}'`);
        continue;
      }
      own.add(member.name);
      const inherited = fields.find((f) => f.name === member.name);
      if (inherited) {
        this.host.report(member.nameSpan, `'${member.name}' is already a field of '${inherited.owner.name}'; a subclass cannot declare it again`);
        continue;
      }
      if (!this.host.typeExists(type)) {
        this.host.report(member.type.span, `unknown type '${baseTypeOf(type)}'`);
        continue;
      }
      fields.push({ name: member.name, type, access: member.access, owner: entry, init: member.init, decl: member });
    }
    entry.fields = fields;

    for (const member of decl.members) {
      if (member.kind === "MethodDecl") {
        if (entry.methods.has(member.name)) {
          this.host.report(member.nameSpan, `class '${decl.name}' already has a method named '${member.name}' (two methods cannot share a name, even with different parameters)`);
          continue;
        }
        const method: MethodInfo = { name: member.name, decl: member, owner: entry, access: member.access };
        entry.methods.set(member.name, method);
        const inherited = this.findMethod(entry.parent, member.name);
        if (inherited !== null) this.checkOverride(method, inherited);
      } else if (member.kind === "CtorDecl") {
        if (entry.ctors.some((c) => c.decl.params.length === member.params.length)) {
          const n = member.params.length;
          this.host.report(member.nameSpan, `class '${decl.name}' already has a constructor with ${n} parameter${n === 1 ? "" : "s"}`);
          continue;
        }
        entry.ctors.push({ decl: member, owner: entry, access: member.access });
      }
    }
    this.checkSuperCalls(entry);
    entry.state = "done";
  }

  private checkOverride(method: MethodInfo, inherited: MethodInfo): void {
    const at = method.decl.nameSpan;
    if (inherited.access === "private") {
      this.host.report(at, `'${method.name}' is private in '${inherited.owner.name}' and cannot be overridden`);
    } else if (methodSignature(method.decl) !== methodSignature(inherited.decl)) {
      this.host.report(at, `'${method.name}' in '${method.owner.name}' overrides '${method.name}' of '${inherited.owner.name}', so it must have the same parameters and return type: ${methodSignature(inherited.decl)}`);
    } else if (method.access === "private") {
      this.host.report(at, `an overriding method cannot be private: '${method.name}' is public in '${inherited.owner.name}'`);
    }
  }

  /** Every constructor must say how the parent is built: with super(...), or implicitly with no arguments. */
  private checkSuperCalls(entry: ClassInfo): void {
    const parent = entry.parent;
    if (parent === null) {
      if (entry.decl.superName !== null) return; // the parent was wrong and that was reported
      for (const ctor of entry.ctors) {
        const call = superCallOf(ctor.decl.body.body);
        if (call !== null) this.host.report(call.span, `'${entry.name}' has no parent class, so super(...) cannot be used`);
      }
      return;
    }
    const withoutArguments = parent.ctors.length === 0 || parent.ctors.some((c) => c.decl.params.length === 0);
    const mustCallSuper = (span: Span): void => {
      this.host.report(span, `'${entry.name}' must start its constructor with super(...): '${parent.name}' has no constructor without arguments`);
    };
    if (entry.ctors.length === 0 && !withoutArguments) mustCallSuper(entry.decl.nameSpan);
    for (const ctor of entry.ctors) {
      const call = superCallOf(ctor.decl.body.body);
      if (call === null) {
        if (!withoutArguments) mustCallSuper(ctor.decl.nameSpan);
        continue;
      }
      const arities = parent.ctors.length === 0 ? [0] : parent.ctors.map((c) => c.decl.params.length);
      if (!arities.includes(call.args.length)) {
        const n = call.args.length;
        this.host.report(call.span, `'${parent.name}' has no constructor with ${n} argument${n === 1 ? "" : "s"}; it has ${arities.join(" or ")}`);
      }
    }
  }
}
