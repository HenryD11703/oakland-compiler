import { describe, expect, it } from "vitest";
import { out, problems, runOak } from "../helpers/run";

describe("arrays (AC-17)", () => {
  it("creates arrays from a list, from a size and by copy", () => {
    expect(out("int[] a = {2, 4, 6}; int[] z = new int[3]; int[] c = a; System.out.println(a, z, c);")).toBe("[2, 4, 6] [0, 0, 0] [2, 4, 6]");
  });

  it("reads and writes elements", () => {
    expect(out("int[] a = {2, 4, 6}; a[2] = 20; System.out.println(a[0], a[2]);")).toBe("2 20");
  });

  it("copies on declaration, as the course sample expects", () => {
    expect(out("int[] a = {2, 4, 6}; int[] c = a; a[2] = 20; System.out.println(c[2], a[2]);")).toBe("6 20");
  });

  it("shares on plain assignment and when passed to a function", () => {
    expect(out("int[] a = {1}; int[] b = {2}; b = a; a[0] = 9; System.out.println(b[0]);")).toBe("9");
  });

  it("copies nested arrays all the way down", () => {
    expect(out("int[][] m = {{1, 2}, {3, 4}}; int[][] c = m; m[0][0] = 99; System.out.println(c[0][0], m[0][0]);")).toBe("1 99");
  });

  it("starts new arrays with the default of each type", () => {
    expect(out("System.out.println(new int[2], new float[2], new boolean[2], new string[1]);")).toBe("[0, 0] [0.0, 0.0] [false, false] []");
    expect(out("string[] s = new string[2]; System.out.println(s[0] == \"\");")).toBe("true");
    expect(out("Person[] p = new Person[2]; struct Person { int a; } System.out.println(p[0] == null);")).toBe("true");
  });

  it("supports matrices of any depth", () => {
    expect(out("int[][][] m = {{{1, 2}, {3, 4}}, {{5, 6}, {7, 8}}}; System.out.println(m[0][0][0], m[1][1][1], m[1][0][1]);")).toBe("1 8 6");
    expect(out("int[][][] m = new int[2][2][2]; m[1][1][1] = 20; System.out.println(m[0][0][0], m[1][1][1]);")).toBe("0 20");
    expect(out("int[][] m = new int[2][3]; System.out.println(m);")).toBe("[[0, 0, 0], [0, 0, 0]]");
    expect(out("int[][] m = {{1, 2}, {3, 4}}; System.out.println(m);")).toBe("[[1, 2], [3, 4]]");
  });

  it("has length, indexOf and join", () => {
    expect(out("int[] a = {2, 4, 6, 8, 10}; System.out.println(a.length, a.indexOf(10), a.indexOf(5), a.join());")).toBe("5 4 -1 2, 4, 6, 8, 10");
    expect(out('string[] s = {"x", "y"}; System.out.println(s.join(), s.indexOf("y"));')).toBe("x, y 1");
    expect(out("int[][] m = {{1}, {2}}; System.out.println(m.length, m[0].length);")).toBe("2 1");
    expect(out("float[] f = {1, 2.5}; System.out.println(f, f.indexOf(1), f.indexOf(2.5));")).toBe("[1.0, 2.5] 0 1");
  });

  it("widens int elements into a float array", () => {
    expect(out("float[] f = {1, 2.5}; f[0] = 3; System.out.println(f);")).toBe("[3.0, 2.5]");
  });

  it("loops with the length", () => {
    expect(out("int[] a = {3, 5}; for (int i = 0; i < a.length; i++) { System.out.println(a[i]); }")).toBe("3\n5");
  });

  it("changes elements with += and ++", () => {
    expect(out("int[] a = {1}; a[0] += 5; a[0]++; System.out.println(a[0]);")).toBe("7");
  });
});

describe("array mistakes", () => {
  it("reports an index out of range with the index and the length", () => {
    expect(problems("int[] a = {1, 2}; System.out.println(a[5]);")).toEqual(["index 5 is out of range for an array of length 2"]);
    expect(problems("int[] a = {1, 2}; System.out.println(a[-1]);")).toEqual(["index -1 is out of range for an array of length 2"]);
    expect(problems("int[] a = {1, 2}; a[2] = 3;")).toEqual(["index 2 is out of range for an array of length 2"]);
    expect(problems("int[][] m = new int[2][2]; m[0][2] = 1;")).toEqual(["index 2 is out of range for an array of length 2"]);
  });

  it("needs an int index on an array", () => {
    expect(problems("int[] a = {1}; System.out.println(a[0.5]);")).toEqual(["an array index must be an int, but it is float"]);
    expect(problems('int[] a = {1}; System.out.println(a["x"]);')).toEqual(["an array index must be an int, but it is string"]);
    expect(problems("int x = 3; System.out.println(x[0]);")).toEqual(["cannot index a value of type int"]);
    expect(problems("int[] a; System.out.println(a[0]);")).toEqual(["cannot index null"]);
  });

  it("checks the elements of a list", () => {
    expect(problems('int[] a = {1, "x", 3};')).toEqual(["element 2 must be int, but it is string"]);
    expect(problems("int[][] m = {1, 2};")).toEqual(["element 1 must be int[], but it is int", "element 2 must be int[], but it is int"]);
    expect(problems("int[] a = {{1}, {2}};")).toEqual([
      "element 1 cannot be a list of values: the elements are int",
      "element 2 cannot be a list of values: the elements are int",
    ]);
    expect(problems("int x = {1, 2};")).toEqual(["cannot use a list of values for type int"]);
  });

  it("checks the type of a stored element", () => {
    expect(problems('int[] a = {1}; a[0] = "x";')).toEqual(["cannot assign string to int"]);
    expect(out('int[] a = {1}; a[0] = 5; a[0] = 6; System.out.println(a);')).toBe("[6]");
  });

  it("checks sizes and the declared type of new", () => {
    expect(problems("int[] a = new int[-1];")).toEqual(["an array size cannot be negative (-1)"]);
    expect(problems("int[] a = new int[1.5];")).toEqual(["an array size must be an int, but it is float"]);
    expect(problems("int[][] a = new int[2];")).toEqual(["cannot assign int[] to int[][]"]);
    expect(problems("int[] a = new float[2];")).toEqual(["cannot assign float[] to int[]"]);
    expect(problems("Foo[] a = new Foo[2];")).toEqual(["unknown type 'Foo'"]);
  });

  it("limits the size of one array", () => {
    expect(problems("int[] a = new int[2000000];")).toEqual(["the array is too large (limit: 1,000,000 elements)"]);
    expect(problems("int[][] a = new int[2000][2000];")).toEqual(["the array is too large (limit: 1,000,000 elements)"]);
  });

  it("explains the members arrays do not have", () => {
    expect(problems("int[] a = {1}; System.out.println(a.size);")).toEqual(["arrays have no member 'size' (they have length, indexOf and join)"]);
    expect(problems("int[] a = {1}; a.push(2);")).toEqual(["arrays have no method 'push' (they have length, indexOf and join)"]);
    expect(problems("int[] a = {1}; a.join(1);")).toEqual(["join expects no arguments"]);
    expect(problems('int[] a = {1}; a.indexOf("x");')).toEqual(["indexOf needs a int, but got string"]);
    expect(problems("int[] a; System.out.println(a.length);")).toEqual(["cannot read length of null"]);
    expect(problems('string s = "abc"; System.out.println(s.length);')).toEqual(["a value of type string has no member 'length'"]);
  });
});

describe("structs (AC-18)", () => {
  const PERSON = "struct Pet { string name; } struct Person { string name; int age; Pet pet; }\n";

  it("creates, reads, changes and prints", () => {
    expect(
      out(
        PERSON +
          'Person p = Person{name: "Ana", age: 20, pet: Pet{name: "Rex"}};' +
          "System.out.println(p.name, p.age, p.pet.name, typeof p);" +
          "p.age = 21; p.age++; p.age += 2; p.pet.name = \"Max\";" +
          "System.out.println(p);",
      ),
    ).toBe("Ana 20 Rex Person\nPerson{name: Ana, age: 24, pet: Pet{name: Max}}");
  });

  it("leaves the fields that were not given as null", () => {
    expect(out(PERSON + 'Person p = Person{name: "Ana"}; System.out.println(p.age, p.pet, p.pet == null);')).toBe("null null true");
    expect(out(PERSON + "Person p = Person{}; System.out.println(p);")).toBe("Person{name: null, age: null, pet: null}");
  });

  it("can be declared after its use", () => {
    expect(out('Person p = Person{name: "Ana", age: 1}; System.out.println(p.name); struct Person { string name; int age; }')).toBe("Ana");
  });

  it("allows a trailing semicolon after the declaration", () => {
    expect(out('struct P { int x; }; P p = P{x: 3}; System.out.println(p.x);')).toBe("3");
  });

  it("shares a struct between variables and functions", () => {
    expect(out(PERSON + 'void older(Person p) { p.age++; } Person a = Person{name: "A", age: 1}; Person b = a; older(a); System.out.println(a.age, b.age);')).toBe("2 2");
  });

  it("can be returned from a function and kept in arrays", () => {
    expect(
      out(
        PERSON +
          'Person make(string n) { return Person{name: n, age: 18}; }' +
          'Person[] people = new Person[2]; people[0] = make("A"); people[1] = make("B");' +
          "for (Person p : people) { System.out.println(p.name); } System.out.println(people.length);",
      ),
    ).toBe("A\nB\n2");
  });

  it("widens an int into a float field", () => {
    expect(out("struct S { float f; } S s = S{f: 2}; System.out.println(s.f);")).toBe("2.0");
  });

  it("reports unknown and repeated fields, wrong types and unknown structs", () => {
    expect(problems(PERSON + 'Person p = Person{nope: 1};')).toEqual(["struct 'Person' has no field 'nope'"]);
    expect(problems(PERSON + 'Person p = Person{name: "a", name: "b"};')).toEqual(["the field 'name' is given twice"]);
    expect(problems(PERSON + 'Person p = Person{age: "x"};')).toEqual(["the field 'age' of 'Person' must be int, but it is string"]);
    expect(problems(PERSON + 'Person p = Person{name: "a"}; System.out.println(p.nope);')).toEqual(["struct 'Person' has no field 'nope'"]);
    expect(problems(PERSON + 'Person p = Person{name: "a"}; p.nope = 1;')).toEqual(["struct 'Person' has no field 'nope'"]);
    expect(problems(PERSON + 'Person p = Person{name: "a"}; p.age = "x";')).toEqual(["cannot assign string to int"]);
    expect(problems(PERSON + "Pet q = Person{};")).toEqual(["cannot assign Person to Pet"]);
  });

  it("reports use of a null struct", () => {
    expect(problems(PERSON + "Person p; System.out.println(p.name);")).toEqual(["cannot read field 'name' of null"]);
    expect(problems(PERSON + "Person p; p.name = \"x\";")).toEqual(["cannot use field 'name' of null"]);
    expect(problems("int x = 1; System.out.println(x.name);")).toEqual(["a value of type int has no member 'name'"]);
  });

  it("reports a repeated field and a struct declared twice", () => {
    expect(problems("struct S { int a; int a; }")).toEqual(["struct 'S' already has a field named 'a'"]);
    expect(problems("struct S { int a; } struct S { int b; }")).toEqual(["'S' is already declared in this scope"]);
  });

  it("compares structs by identity", () => {
    expect(out("struct S { int a; } S x = S{a: 1}; S y = S{a: 1}; S z = x; System.out.println(x == y, x == z);")).toBe("false true");
  });

  it("does not loop on a struct that points to itself", () => {
    expect(out("struct N { N next; int v; } N a = N{v: 1}; a.next = a; System.out.println(a);")).toBe("N{next: N{...}, v: 1}");
  });

  it("is not confused with a block after an ordinary name", () => {
    const result = runOak("struct S { int x; } int s = 1; if (s == 1) { System.out.println(s); }");
    expect(result.diagnostics).toEqual([]);
    expect(result.stdout).toBe("1\n");
  });
});
