import { elementTypeOf } from "../types";
import type { Part, Trace, TraceEvent, TraceObject, TraceStep } from "./types";

export interface ReplayVar {
  id: number;
  name: string;
  type: string;
  value: Part;
}

export interface ReplayScope {
  id: number;
  label: string;
  vars: ReplayVar[];
}

export interface ReplayFrame {
  /** `global` or the function's name. */
  name: string;
  scopes: ReplayScope[];
}

export interface ReplayObject {
  id: number;
  type: string;
  length: number;
  items: Part[] | null;
  fields: { name: string; type: string; value: Part }[] | null;
}

/** Everything the interface shows at one step. A copy: the caller may keep or change it. */
export interface ReplayState {
  /** The call stack, `global` first. */
  frames: ReplayFrame[];
  heap: Map<number, ReplayObject>;
  /** Characters of stdout printed so far. */
  outputLength: number;
}

/** What a step touched, so the interface can mark it. */
export interface ReplayChanges {
  variables: Set<number>;
  objects: Set<number>;
}

/** The state before the first step. */
export function initialState(): ReplayState {
  return { frames: [{ name: "global", scopes: [{ id: 0, label: "global", vars: [] }] }], heap: new Map(), outputLength: 0 };
}

export function cloneState(state: ReplayState): ReplayState {
  return {
    frames: state.frames.map((frame) => ({
      name: frame.name,
      scopes: frame.scopes.map((scope) => ({ id: scope.id, label: scope.label, vars: scope.vars.map((v) => ({ ...v })) })),
    })),
    heap: new Map([...state.heap].map(([id, object]) => [id, cloneObject(object)])),
    outputLength: state.outputLength,
  };
}

function cloneObject(object: TraceObject | ReplayObject): ReplayObject {
  return {
    id: object.id,
    type: object.type,
    length: object.length,
    items: object.items === null ? null : [...object.items],
    fields: object.fields === null ? null : object.fields.map((f) => ({ ...f })),
  };
}

function applyEvent(state: ReplayState, event: TraceEvent): void {
  const frame = state.frames[state.frames.length - 1];
  switch (event.t) {
    case "push-frame":
      state.frames.push({ name: event.name, scopes: [] });
      return;
    case "pop-frame":
      if (state.frames.length > 1) state.frames.pop();
      return;
    case "push-scope":
      frame?.scopes.push({ id: event.id, label: event.label, vars: [] });
      return;
    case "pop-scope":
      frame?.scopes.pop();
      return;
    case "declare":
      frame?.scopes[frame.scopes.length - 1]?.vars.push({ ...event.variable });
      return;
    case "set-var": {
      for (let f = state.frames.length - 1; f >= 0; f--) {
        for (const scope of (state.frames[f] as ReplayFrame).scopes) {
          const variable = scope.vars.find((v) => v.id === event.id);
          if (variable) {
            variable.value = event.value;
            return;
          }
        }
      }
      return;
    }
    case "alloc":
      state.heap.set(event.object.id, cloneObject(event.object));
      return;
    case "set-item": {
      const object = state.heap.get(event.object);
      if (object?.items && event.index < object.items.length) object.items[event.index] = event.value;
      return;
    }
    case "set-field": {
      const field = state.heap.get(event.object)?.fields?.find((f) => f.name === event.name);
      if (field) field.value = event.value;
      return;
    }
  }
}

function applyStep(state: ReplayState, step: TraceStep): void {
  for (const event of step.events) applyEvent(state, event);
  state.outputLength = step.outputLength;
}

/** Steps through a trace in either direction. State is rebuilt from the nearest saved checkpoint, so going back is cheap. */
export class TraceReplayer {
  /** A full copy of the state is kept every this many steps. */
  static readonly CHECKPOINT_EVERY = 500;

  private position = -1;
  private state: ReplayState = initialState();
  private readonly checkpoints = new Map<number, ReplayState>([[-1, initialState()]]);

  constructor(private readonly trace: Trace) {}

  get length(): number {
    return this.trace.steps.length;
  }

  step(index: number): TraceStep | undefined {
    return this.trace.steps[index];
  }

  /** The state after step `index`; -1 is the state before the first step. */
  stateAt(index: number): ReplayState {
    const target = Math.max(-1, Math.min(index, this.trace.steps.length - 1));
    if (target < this.position) this.restoreBefore(target);
    while (this.position < target) {
      this.position++;
      applyStep(this.state, this.trace.steps[this.position] as TraceStep);
      if ((this.position + 1) % TraceReplayer.CHECKPOINT_EVERY === 0 && !this.checkpoints.has(this.position)) {
        this.checkpoints.set(this.position, cloneState(this.state));
      }
    }
    return cloneState(this.state);
  }

  /** Variables and heap objects that step `index` created or changed. */
  changesAt(index: number): ReplayChanges {
    const changes: ReplayChanges = { variables: new Set(), objects: new Set() };
    for (const event of this.trace.steps[index]?.events ?? []) {
      if (event.t === "declare") changes.variables.add(event.variable.id);
      else if (event.t === "set-var") changes.variables.add(event.id);
      else if (event.t === "alloc") changes.objects.add(event.object.id);
      else if (event.t === "set-item" || event.t === "set-field") changes.objects.add(event.object);
    }
    return changes;
  }

  private restoreBefore(target: number): void {
    let best = -1;
    for (const position of this.checkpoints.keys()) if (position <= target && position > best) best = position;
    this.state = cloneState(this.checkpoints.get(best) as ReplayState);
    this.position = best;
  }
}

/** Text for a value, expanding arrays and structs from the heap. Strings are quoted when `quote` is set. */
export function renderValue(state: ReplayState, value: Part, type: string, quote = false): string {
  return render(state, value, type, quote, new Set());
}

function render(state: ReplayState, value: Part, type: string, quote: boolean, seen: Set<number>): string {
  if ("text" in value) {
    if (quote && type === "string") return JSON.stringify(value.text);
    if (quote && type === "char") return `'${value.text}'`;
    return value.text;
  }
  const object = state.heap.get(value.ref);
  if (object === undefined) return "…";
  if (seen.has(object.id)) return object.items ? "[…]" : `${object.type}{…}`;
  seen.add(object.id);
  let text: string;
  if (object.items) {
    const elementType = elementTypeOf(object.type);
    const shown = object.items.map((item) => render(state, item, elementType, quote, seen));
    if (object.length > object.items.length) shown.push(`… ${object.length - object.items.length} more`);
    text = `[${shown.join(", ")}]`;
  } else {
    const fields = (object.fields ?? []).map((f) => `${f.name}: ${render(state, f.value, f.type, quote, seen)}`);
    text = `${object.type}{${fields.join(", ")}}`;
  }
  seen.delete(object.id);
  return text;
}
