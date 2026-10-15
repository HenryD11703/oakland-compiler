import type { Binding } from "../interpreter/environment";
import { display, OakArray, OakStruct, type Value } from "../interpreter/values";
import { elementTypeOf } from "../interpreter/types";
import type { Span } from "../span";
import {
  MAX_TRACE_ITEMS,
  MAX_TRACE_STEPS,
  type Part,
  type StepKind,
  type Trace,
  type TraceEvent,
  type TraceObject,
  type TraceStep,
} from "./types";

/**
 * Collects the trace while the interpreter runs. It never changes how the program behaves; when the step
 * limit is reached it simply stops recording.
 */
export class TraceRecorder {
  private readonly steps: TraceStep[] = [];
  private truncated = false;
  /** Scope and frame changes wait here and are applied at the start of the next step. */
  private pending: TraceEvent[] = [];
  private current: TraceStep | null = null;
  private lastOutput = 0;

  private nextVariable = 1;
  private nextObject = 1;
  private nextScope = 1;
  private readonly variableIds = new WeakMap<object, number>();
  private readonly objectIds = new WeakMap<object, number>();
  private readonly scopeIds = new WeakMap<object, number>();

  constructor(globalScope: object) {
    this.scopeIds.set(globalScope, 0);
  }

  // ---------- steps ----------

  beginStep(kind: StepKind, span: Span, note: string | null = null): void {
    if (this.truncated) return;
    if (this.steps.length >= MAX_TRACE_STEPS) {
      this.truncated = true;
      this.pending = [];
      return;
    }
    const step: TraceStep = { kind, span, events: this.pending, outputLength: this.lastOutput, note };
    this.pending = [];
    this.steps.push(step);
    this.current = step;
  }

  note(text: string): void {
    if (this.current && !this.truncated) this.current.note = text;
  }

  /** The line being executed right now (a call remembers it, to come back to it). */
  currentSpan(): Span | null {
    return this.current?.span ?? null;
  }

  output(totalLength: number): void {
    this.lastOutput = totalLength;
    if (this.current && !this.truncated) this.current.outputLength = totalLength;
  }

  finish(endSpan: Span): Trace {
    this.beginStep("end", endSpan);
    return { steps: this.steps, truncated: this.truncated };
  }

  // ---------- scopes and frames (take effect at the next step) ----------

  pushScope(scope: object, label: string): void {
    if (this.truncated) return;
    const id = this.nextScope++;
    this.scopeIds.set(scope, id);
    this.pending.push({ t: "push-scope", id, label });
  }

  popScope(): void {
    if (!this.truncated) this.pending.push({ t: "pop-scope" });
  }

  pushFrame(name: string): void {
    if (!this.truncated) this.pending.push({ t: "push-frame", name });
  }

  /** The call finished: control returns to `site`, the line that made the call. */
  endCall(site: Span, returned: Value): void {
    if (this.truncated) return;
    const text = returned.type === "void" || returned.type === "error" ? null : this.text(returned.value, returned.type);
    this.beginStep("return", site, text === null ? null : `returned ${text}`);
    this.add({ t: "pop-frame", returned: text }, false);
  }

  // ---------- data ----------

  /** `deferred` is for parameters: they are visible from the first step inside the function, not before. */
  declare(binding: Binding, deferred = false): void {
    if (this.truncated) return;
    const id = this.nextVariable++;
    this.variableIds.set(binding, id);
    const value = this.partOf(binding.poisoned ? null : binding.value, binding.type, deferred);
    this.add({ t: "declare", variable: { id, name: binding.name, type: binding.type, value } }, deferred);
  }

  setVariable(binding: Binding): void {
    if (this.truncated) return;
    const id = this.variableIds.get(binding);
    if (id === undefined) return;
    const value = this.partOf(binding.poisoned ? null : binding.value, binding.type, false);
    this.add({ t: "set-var", id, value }, false);
  }

  setItem(array: OakArray, index: number): void {
    if (this.truncated || index >= MAX_TRACE_ITEMS) return;
    const object = this.objectIds.get(array);
    if (object === undefined) return; // not shown anywhere yet: it will be recorded with its current contents
    const value = this.partOf(array.items[index], array.elementType, false);
    this.add({ t: "set-item", object, index, value }, false);
  }

  setField(struct: OakStruct, name: string): void {
    if (this.truncated) return;
    const object = this.objectIds.get(struct);
    const field = struct.fields.find((f) => f.name === name);
    if (object === undefined || field === undefined) return;
    this.add({ t: "set-field", object, name, value: this.partOf(struct.values.get(name), field.type, false) }, false);
  }

  // ---------- internals ----------

  private add(event: TraceEvent, deferred: boolean): void {
    if (deferred || this.current === null) {
      this.pending.push(event);
      return;
    }
    // Anything still waiting must come first to keep the order the interpreter produced the events in.
    if (this.pending.length > 0) {
      this.current.events.push(...this.pending);
      this.pending = [];
    }
    this.current.events.push(event);
  }

  private text(raw: unknown, type: string): string {
    return display(raw, type);
  }

  private partOf(raw: unknown, type: string, deferred: boolean): Part {
    if (raw instanceof OakArray || raw instanceof OakStruct) return { ref: this.objectOf(raw, type, deferred) };
    return { text: this.text(raw, type) };
  }

  /** Gives an array or struct an id, recording its contents the first time it is seen. */
  private objectOf(object: OakArray | OakStruct, type: string, deferred: boolean): number {
    const known = this.objectIds.get(object);
    if (known !== undefined) return known;
    const id = this.nextObject++;
    this.objectIds.set(object, id); // set first: a struct that contains itself must not recurse forever
    let recorded: TraceObject;
    if (object instanceof OakArray) {
      const elementType = object.elementType === "" ? elementTypeOf(type) : object.elementType;
      const items = object.items.slice(0, MAX_TRACE_ITEMS).map((item) => this.partOf(item, elementType, deferred));
      recorded = { id, type: `${elementType}[]`, length: object.items.length, items, fields: null };
    } else {
      const fields = object.fields.map((f) => ({ name: f.name, type: f.type, value: this.partOf(object.values.get(f.name), f.type, deferred) }));
      recorded = { id, type: object.name, length: 0, items: null, fields };
    }
    this.add({ t: "alloc", object: recorded }, deferred);
    return id;
  }
}
