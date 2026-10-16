/** Writes the binary encodings WebAssembly uses. Everything is a plain array of bytes. */
export class ByteWriter {
  readonly bytes: number[] = [];

  get length(): number {
    return this.bytes.length;
  }

  u8(value: number): this {
    this.bytes.push(value & 0xff);
    return this;
  }

  raw(values: readonly number[]): this {
    for (const value of values) this.bytes.push(value & 0xff);
    return this;
  }

  /** An unsigned integer in LEB128: seven bits at a time, low first, the top bit of a byte says "more follows". */
  u32(value: number): this {
    let rest = value >>> 0;
    do {
      let byte = rest & 0x7f;
      rest >>>= 7;
      if (rest !== 0) byte |= 0x80;
      this.bytes.push(byte);
    } while (rest !== 0);
    return this;
  }

  /** A signed 32-bit integer in LEB128. */
  i32(value: number): this {
    let rest = value | 0;
    for (;;) {
      const byte = rest & 0x7f;
      rest >>= 7; // arithmetic shift keeps the sign
      const done = (rest === 0 && (byte & 0x40) === 0) || (rest === -1 && (byte & 0x40) !== 0);
      this.bytes.push(done ? byte : byte | 0x80);
      if (done) return this;
    }
  }

  /** A 64-bit float, little endian. */
  f64(value: number): this {
    const view = new DataView(new ArrayBuffer(8));
    view.setFloat64(0, value, true);
    for (let i = 0; i < 8; i++) this.bytes.push(view.getUint8(i));
    return this;
  }

  /** A name or a string: its length, then its UTF-8 bytes. */
  name(text: string): this {
    const encoded = new TextEncoder().encode(text);
    this.u32(encoded.length);
    for (const byte of encoded) this.bytes.push(byte);
    return this;
  }

  /** A vector: how many, then each item written by `write`. */
  vec<T>(items: readonly T[], write: (item: T, out: ByteWriter) => void): this {
    this.u32(items.length);
    for (const item of items) write(item, this);
    return this;
  }

  append(other: ByteWriter): this {
    for (const byte of other.bytes) this.bytes.push(byte);
    return this;
  }

  /** A section: its id, the size of its contents, then the contents. */
  section(id: number, contents: ByteWriter): this {
    this.u8(id).u32(contents.length).append(contents);
    return this;
  }

  toUint8Array(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}
