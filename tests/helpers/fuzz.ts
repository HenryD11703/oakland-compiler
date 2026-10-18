import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tokenize } from "../../src/core/lexer/lexer";

/**
 * The programs the fuzz tests start from, the ways to break them, and a seeded random number generator, so that a
 * failure can be reproduced from the number in its name. Used by the interpreter's fuzz test and the compiler's.
 */

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const fixtures = join(import.meta.dirname, "..", "fixtures", "prueba");
const FEATURES = `
struct Pet { string name; }
struct Person { string name; int age; Pet pet; }
int fib(int n) { if (n < 2) { return n; } return fib(n - 1) + fib(n - 2); }
void bump(int[] a) { for (int i = 0; i < a.length; i++) { a[i]++; } }
Person p = Person{name: "Ana", age: 20, pet: Pet{name: "Rex"}};
p.age += 2; p.pet.name = "Max";
int[] xs = {3, 1, 2}; int[][] m = new int[2][3]; bump(xs); m[1][2] = fib(10);
float f = 1; f += 0.5; char c = 'a'; string s = "v" + f + c + p.name;
for (int v : xs) { switch (v) { case 2: System.out.println("two"); break; default: System.out.println(v); } }
int k = 0; while (k < 3) { k++; if (k == 2) { continue; } System.out.println(s, k, xs.indexOf(3), xs.join()); }
boolean ok = k > 2 && !(f < 1) || p == null; System.out.println(ok ? "yes" : "no", typeof m, parseInt("12"), toUpperCase(s));
`;
const CLASS_FEATURES = `
class Animal {
    string name; private int age = 3;
    Animal(string name) { this.name = name; }
    string sound() { return "..."; }
    int years() { return age; }
    void speak() { System.out.println(name, sound(), years()); }
}
class Dog extends Animal {
    Animal friend; int[] marks = {1, 2};
    Dog(string name) { super(name); friend = null; }
    string sound() { return "Woof"; }
    void speak() { super.speak(); if (friend != null) { friend.speak(); } marks[0]++; }
}
Animal a = new Dog("Rex"); Dog d = new Dog("Fido"); d.friend = a;
Animal[] zoo = {a, d, new Animal("Generic"), null};
for (Animal z : zoo) { if (z != null) { z.speak(); } }
System.out.println(d.marks, d.friend == a, typeof d, d);
`;
const NESTED_FEATURES = `
int total(int a, int b) {
    int bonus = 10; int[] log = new int[3];
    int inner(int k) { log[0] += k; bonus++; return a + b + bonus + k; }
    void deeper() { int z = 2; void tiny() { bonus += z; } tiny(); }
    deeper();
    return inner(1) + inner(2) + log[0];
}
class Box { int v = 3; int get(int d) { int add() { return v + d; } return add(); } }
System.out.println(total(1, 2), new Box().get(4));
for (int i = 0; i < 3; i++) { int sq() { return i * i; } System.out.println(sq()); }
`;
const examples = join(import.meta.dirname, "..", "..", "src", "examples");
export const BASES: string[] = [
  ...readdirSync(fixtures).sort().map((file) => readFileSync(join(fixtures, file), "utf8")),
  FEATURES,
  CLASS_FEATURES,
  NESTED_FEATURES,
  ...["animals.oak", "bank-account.oak", "linked-list.oak"].map((file) => readFileSync(join(examples, file), "utf8")),
];

export const WORDS = [
  "int", "float", "string", "boolean", "char", "void", "var", "struct", "if", "else", "while", "for", "switch", "case", "default",
  "break", "continue", "return", "new", "true", "false", "null", "typeof", "System", "out", "println", "length", "indexOf", "join",
  "class", "extends", "this", "super", "private", "public", "Animal", "Dog", "speak", "name",
  "parseInt", "toString", "x", "y", "i", "arr", "p", "Person", "f", "0", "1", "7", "2147483647", "3.5", '"s"', "'c'",
];
export const PUNCT = ["(", ")", "[", "]", "{", "}", ",", ";", ":", "?", ".", "+", "-", "*", "/", "%", "<", ">", "=", "!", "==", "!=", "<=", ">=", "&&", "||", "++", "--", "+=", "-="];

type Mutator = (source: string, random: () => number) => string;

const pick = <T>(items: readonly T[], random: () => number): T => items[Math.floor(random() * items.length)] as T;

const MUTATORS: readonly Mutator[] = [
  // delete a token
  (source, random) => {
    const tokens = tokenize(source).tokens.filter((t) => t.type !== "eof");
    if (tokens.length === 0) return source;
    const t = pick(tokens, random);
    return source.slice(0, t.span.start.offset) + source.slice(t.span.end.offset);
  },
  // duplicate a token
  (source, random) => {
    const tokens = tokenize(source).tokens.filter((t) => t.type !== "eof");
    if (tokens.length === 0) return source;
    const t = pick(tokens, random);
    return source.slice(0, t.span.end.offset) + " " + t.text + source.slice(t.span.end.offset);
  },
  // replace a token with another token of the program
  (source, random) => {
    const tokens = tokenize(source).tokens.filter((t) => t.type !== "eof");
    if (tokens.length < 2) return source;
    const target = pick(tokens, random);
    const donor = pick(tokens, random);
    return source.slice(0, target.span.start.offset) + donor.text + source.slice(target.span.end.offset);
  },
  // replace a token with a random word or punctuation
  (source, random) => {
    const tokens = tokenize(source).tokens.filter((t) => t.type !== "eof");
    if (tokens.length === 0) return source;
    const t = pick(tokens, random);
    return source.slice(0, t.span.start.offset) + pick(random() < 0.5 ? WORDS : PUNCT, random) + source.slice(t.span.end.offset);
  },
  // delete a line
  (source, random) => {
    const lines = source.split("\n");
    lines.splice(Math.floor(random() * lines.length), 1);
    return lines.join("\n");
  },
  // duplicate a line
  (source, random) => {
    const lines = source.split("\n");
    const at = Math.floor(random() * lines.length);
    lines.splice(at, 0, lines[at] ?? "");
    return lines.join("\n");
  },
  // swap two lines
  (source, random) => {
    const lines = source.split("\n");
    const a = Math.floor(random() * lines.length);
    const b = Math.floor(random() * lines.length);
    [lines[a], lines[b]] = [lines[b] as string, lines[a] as string];
    return lines.join("\n");
  },
  // insert a character anywhere, quotes and comment openers included
  (source, random) => {
    const at = Math.floor(random() * (source.length + 1));
    return source.slice(0, at) + pick(['"', "'", "/*", "//", "@", "#", "\\", "&", "|", "{", "}", "\0", "é"], random) + source.slice(at);
  },
  // cut the program short
  (source, random) => source.slice(0, Math.floor(random() * source.length)),
  // wrap a piece in deep nesting
  (source, random) => {
    const at = Math.floor(random() * (source.length + 1));
    const depth = 1 + Math.floor(random() * 300);
    return source.slice(0, at) + (random() < 0.5 ? "(".repeat(depth) : "{".repeat(depth)) + source.slice(at);
  },
];

export function mutate(random: () => number): string {
  let source = pick(BASES, random);
  const rounds = 1 + Math.floor(random() * 3);
  for (let i = 0; i < rounds; i++) source = pick(MUTATORS, random)(source, random);
  return source;
}

export function soup(random: () => number): string {
  const length = 1 + Math.floor(random() * 60);
  return Array.from({ length }, () => pick(random() < 0.6 ? WORDS : PUNCT, random)).join(random() < 0.8 ? " " : "");
}

