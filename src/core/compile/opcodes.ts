/** WebAssembly value types the compiler uses: `int`, `char`, `boolean` and addresses are i32; `float` is f64. */
export type ValType = "i32" | "f64";

/** A numeric instruction: its bytes, the types it takes from the stack and the one it leaves (null for none). */
export interface OpInfo {
  readonly code: readonly number[];
  readonly params: readonly ValType[];
  readonly result: ValType | null;
}

const op = (code: readonly number[], params: readonly ValType[], result: ValType | null): OpInfo => ({ code, params, result });
const i2 = ["i32", "i32"] as const;
const f2 = ["f64", "f64"] as const;

/** The numeric and bulk-memory instructions, by their name in the text format. */
export const OPS = {
  // i32 comparisons
  "i32.eqz": op([0x45], ["i32"], "i32"),
  "i32.eq": op([0x46], i2, "i32"),
  "i32.ne": op([0x47], i2, "i32"),
  "i32.lt_s": op([0x48], i2, "i32"),
  "i32.lt_u": op([0x49], i2, "i32"),
  "i32.gt_s": op([0x4a], i2, "i32"),
  "i32.gt_u": op([0x4b], i2, "i32"),
  "i32.le_s": op([0x4c], i2, "i32"),
  "i32.le_u": op([0x4d], i2, "i32"),
  "i32.ge_s": op([0x4e], i2, "i32"),
  "i32.ge_u": op([0x4f], i2, "i32"),
  // f64 comparisons
  "f64.eq": op([0x61], f2, "i32"),
  "f64.ne": op([0x62], f2, "i32"),
  "f64.lt": op([0x63], f2, "i32"),
  "f64.gt": op([0x64], f2, "i32"),
  "f64.le": op([0x65], f2, "i32"),
  "f64.ge": op([0x66], f2, "i32"),
  // i32 arithmetic and bits
  "i32.clz": op([0x67], ["i32"], "i32"),
  "i32.ctz": op([0x68], ["i32"], "i32"),
  "i32.popcnt": op([0x69], ["i32"], "i32"),
  "i32.add": op([0x6a], i2, "i32"),
  "i32.sub": op([0x6b], i2, "i32"),
  "i32.mul": op([0x6c], i2, "i32"),
  "i32.div_s": op([0x6d], i2, "i32"),
  "i32.div_u": op([0x6e], i2, "i32"),
  "i32.rem_s": op([0x6f], i2, "i32"),
  "i32.rem_u": op([0x70], i2, "i32"),
  "i32.and": op([0x71], i2, "i32"),
  "i32.or": op([0x72], i2, "i32"),
  "i32.xor": op([0x73], i2, "i32"),
  "i32.shl": op([0x74], i2, "i32"),
  "i32.shr_s": op([0x75], i2, "i32"),
  "i32.shr_u": op([0x76], i2, "i32"),
  "i32.rotl": op([0x77], i2, "i32"),
  "i32.rotr": op([0x78], i2, "i32"),
  // f64 arithmetic
  "f64.abs": op([0x99], ["f64"], "f64"),
  "f64.neg": op([0x9a], ["f64"], "f64"),
  "f64.ceil": op([0x9b], ["f64"], "f64"),
  "f64.floor": op([0x9c], ["f64"], "f64"),
  "f64.trunc": op([0x9d], ["f64"], "f64"),
  "f64.nearest": op([0x9e], ["f64"], "f64"),
  "f64.sqrt": op([0x9f], ["f64"], "f64"),
  "f64.add": op([0xa0], f2, "f64"),
  "f64.sub": op([0xa1], f2, "f64"),
  "f64.mul": op([0xa2], f2, "f64"),
  "f64.div": op([0xa3], f2, "f64"),
  "f64.min": op([0xa4], f2, "f64"),
  "f64.max": op([0xa5], f2, "f64"),
  "f64.copysign": op([0xa6], f2, "f64"),
  // conversions
  "i32.trunc_f64_s": op([0xaa], ["f64"], "i32"),
  "i32.trunc_f64_u": op([0xab], ["f64"], "i32"),
  "f64.convert_i32_s": op([0xb7], ["i32"], "f64"),
  "f64.convert_i32_u": op([0xb8], ["i32"], "f64"),
  "i32.extend8_s": op([0xc0], ["i32"], "i32"),
  "i32.extend16_s": op([0xc1], ["i32"], "i32"),
  "i32.trunc_sat_f64_s": op([0xfc, 0x02], ["f64"], "i32"),
  // bulk memory (one memory, index 0)
  "memory.copy": op([0xfc, 0x0a, 0x00, 0x00], ["i32", "i32", "i32"], null),
  "memory.fill": op([0xfc, 0x0b, 0x00], ["i32", "i32", "i32"], null),
} as const satisfies Record<string, OpInfo>;

export type OpName = keyof typeof OPS;

/** A load or a store: its opcode, the natural alignment (as a power of two) and the type it moves. */
export interface MemInfo {
  readonly code: number;
  readonly align: number;
  readonly type: ValType;
}

export const LOADS = {
  "i32.load": { code: 0x28, align: 2, type: "i32" },
  "f64.load": { code: 0x2b, align: 3, type: "f64" },
  "i32.load8_s": { code: 0x2c, align: 0, type: "i32" },
  "i32.load8_u": { code: 0x2d, align: 0, type: "i32" },
  "i32.load16_s": { code: 0x2e, align: 1, type: "i32" },
  "i32.load16_u": { code: 0x2f, align: 1, type: "i32" },
} as const satisfies Record<string, MemInfo>;

export const STORES = {
  "i32.store": { code: 0x36, align: 2, type: "i32" },
  "f64.store": { code: 0x39, align: 3, type: "f64" },
  "i32.store8": { code: 0x3a, align: 0, type: "i32" },
  "i32.store16": { code: 0x3b, align: 1, type: "i32" },
} as const satisfies Record<string, MemInfo>;

export type LoadName = keyof typeof LOADS;
export type StoreName = keyof typeof STORES;

/** The bytes of the structure of a module, named once. */
export const WASM = {
  magic: [0x00, 0x61, 0x73, 0x6d],
  version: [0x01, 0x00, 0x00, 0x00],
  valType: { i32: 0x7f, f64: 0x7c } as Record<ValType, number>,
  empty: 0x40,
  funcType: 0x60,
  funcRef: 0x70,
  section: { type: 1, import: 2, function: 3, table: 4, memory: 5, global: 6, export: 7, start: 8, element: 9, code: 10, data: 11 },
  exportKind: { func: 0, table: 1, memory: 2, global: 3 },
} as const;
