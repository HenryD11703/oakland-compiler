import { describe, expect, it } from "vitest";
import { compile } from "../../src/core/compile/index";

/**
 * D20, "golden WAT": six small programs have the WebAssembly the compiler makes for them committed in `tests/golden/wat/`,
 * so that a change to the compiler shows up in a diff that a person can read. After a change that is meant, run
 * `npx vitest run tests/unit/golden-wat.test.ts -u` and read the diff.
 */
const PROGRAMS: [string, string][] = [
  ["arithmetic", "int a = 2147483647;\nint b = a + 1;\nfloat f = b / 4 + 0.5;\nSystem.out.println(b, f, 7 % 3);\n"],
  ["loop", "int sum = 0;\nfor (int i = 0; i < 10; i++) {\n  if (i % 2 == 0) { sum += i; }\n}\nSystem.out.println(sum);\n"],
  ["recursion", "int fib(int n) {\n  if (n < 2) { return n; }\n  return fib(n - 1) + fib(n - 2);\n}\nSystem.out.println(fib(10));\n"],
  ["strings", 'string s = "Oak" + "Land";\nint n = 3;\nSystem.out.println(s + n + true, s == "OakLand");\n'],
  ["arrays", "int[] a = {3, 1, 2};\na[1] += a[0];\nint t = 0;\nfor (int x : a) { t += x; }\nSystem.out.println(a, t, a.indexOf(2));\n"],
  ["classes", 'class Animal {\n  string sound() { return "..."; }\n}\nclass Dog extends Animal {\n  string sound() { return "Woof"; }\n}\nAnimal a = new Dog();\nSystem.out.println(a.sound());\n'],
];

describe("the WebAssembly of six small programs, as committed (D20)", () => {
  it.each(PROGRAMS)("%s", async (name, source) => {
    const result = compile(source);
    expect(result.diagnostics).toEqual([]);
    await expect(`${result.wat as string}\n`).toMatchFileSnapshot(`../golden/wat/${name}.wat`);
  });
});
