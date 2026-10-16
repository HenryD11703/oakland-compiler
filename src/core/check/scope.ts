import type { ClassInfo } from "../classes";
import type { FuncDecl, StructDecl } from "../parser/ast";
import type { Span } from "../span";

/** A variable, parameter or loop variable. */
export interface VarSym {
  readonly kind: "variable";
  readonly name: string;
  readonly type: string;
  readonly declaredAt: Span;
  /** True for an int, float, boolean or char declared without a value: it must be assigned before it is read. */
  readonly needsAssignment: boolean;
}

export interface FuncSym {
  readonly kind: "function";
  readonly name: string;
  readonly decl: FuncDecl;
}

export interface StructSym {
  readonly kind: "struct";
  readonly name: string;
  readonly decl: StructDecl;
  /** Resolved when the struct is declared; a field whose type does not exist is left out (that was reported). */
  readonly fields: { name: string; type: string }[];
}

export type Sym = VarSym | FuncSym | StructSym | ClassInfo;

/** One scope. Variables, functions, structs and classes share one namespace, like in Java. */
export class Scope {
  private readonly entries = new Map<string, Sym>();

  constructor(
    readonly parent: Scope | null,
    /** Set on the top scope of a method or a constructor: the class whose `this` and fields are visible. */
    readonly thisClass: ClassInfo | null = null,
  ) {}

  /** False (and nothing changes) when the name is already taken in this scope. */
  declare(sym: Sym): boolean {
    if (this.entries.has(sym.name)) return false;
    this.entries.set(sym.name, sym);
    return true;
  }

  getOwn(name: string): Sym | undefined {
    return this.entries.get(name);
  }

  lookup(name: string): Sym | undefined {
    return this.entries.get(name) ?? this.parent?.lookup(name);
  }

  /** The class of the nearest enclosing method or constructor, or null. */
  enclosingClass(): ClassInfo | null {
    return this.thisClass ?? this.parent?.enclosingClass() ?? null;
  }
}
