import type { FuncDecl, StructDecl } from "../parser/ast";
import type { Span } from "../span";
import type { StructField } from "./values";

export interface Binding {
  readonly kind: "variable";
  readonly name: string;
  /** Fixed when declared. `error` means the declaration failed; the first valid assignment fixes the type. */
  type: string;
  value: unknown;
  /** True while the variable holds null because of an earlier error; reading it stays silent. */
  poisoned: boolean;
  readonly declaredAt: Span;
}

export interface FunctionEntry {
  readonly kind: "function";
  readonly name: string;
  readonly decl: FuncDecl;
  /** The scope the function was declared in; its body sees those names. */
  readonly closure: Environment;
  readonly declaredAt: Span;
}

export interface StructEntry {
  readonly kind: "struct";
  readonly name: string;
  readonly decl: StructDecl;
  readonly fields: readonly StructField[];
  readonly declaredAt: Span;
}

export type Entry = Binding | FunctionEntry | StructEntry;

/** One scope. Variables, functions and structs share one namespace, like in Java. */
export class Environment {
  private readonly entries = new Map<string, Entry>();
  private readonly processed = new Set<object>();

  constructor(
    readonly parent: Environment | null,
    /** `global`, `block`, `for`, `function f`...: shown in the symbol table. */
    readonly label: string,
  ) {}

  /**
   * Records that a declaration node was handled in this scope. Returns false if it already was, so that a
   * declaration processed when its scope was entered (hoisting) is not processed, or reported, a second time.
   */
  firstVisit(node: object): boolean {
    if (this.processed.has(node)) return false;
    this.processed.add(node);
    return true;
  }

  /** Returns false (and changes nothing) if the name already exists in this scope. */
  declare(entry: Entry): boolean {
    if (this.entries.has(entry.name)) return false;
    this.entries.set(entry.name, entry);
    return true;
  }

  getOwn(name: string): Entry | undefined {
    return this.entries.get(name);
  }

  lookup(name: string): Entry | undefined {
    return this.entries.get(name) ?? this.parent?.lookup(name);
  }

  values(): IterableIterator<Entry> {
    return this.entries.values();
  }
}
