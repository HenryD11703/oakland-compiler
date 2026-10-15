# OakLand language reference

OakLand is a small Java-like language: static types, arrays and matrices of any depth, functions, structs. This page describes all of it.

**Every example on this page is run by the test suite.** The block marked `output` under an `oak` block is exactly what the program prints; a block marked `problems` lists the diagnostics it produces (`line:column message`). If this page says something false, a test fails. The formal grammar is in [`grammar.ebnf`](grammar.ebnf); what changed from the original interpreter is in [`language-changes.md`](language-changes.md).

## Programs

A program is a list of statements. Statements end with `;`, blocks are written `{ ... }`, and comments are `// to the end of the line` or `/* between marks */`.

```oak
// Print two lines.
System.out.println("Hello"); /* a block comment */
System.out.println("OakLand");
```
```output
Hello
OakLand
```

`System.out.println` takes any number of values, shows them separated by one space, and ends the line. With no values it prints an empty line.

```oak
System.out.println("a", 1, true, 2.5, 'c');
System.out.println();
System.out.println("done");
```
```output
a 1 true 2.5 c

done
```

## Types

| Type | Holds | Example |
|---|---|---|
| `int` | a 32-bit whole number | `42` |
| `float` | a decimal number (a 64-bit IEEE double) | `3.14` |
| `string` | text | `"hello"` |
| `boolean` | `true` or `false` | `true` |
| `char` | one character | `'x'` |
| `T[]`, `T[][]`... | an array, or a matrix, of `T` | `int[] a = {1, 2}` |
| a struct name | a struct value | `Person p` |

`null` means "no value". Strings accept the escapes `\n`, `\t`, `\r`, `\0`, `\"`, `\'` and `\\`.

`typeof` tells the type of any value:

```oak
System.out.println(typeof 1, typeof 1.5, typeof "s", typeof 'c', typeof true, typeof null);
int[] a = {1};
System.out.println(typeof a);
```
```output
int float string char boolean null
int[]
```

## Variables

Declare a variable with its type, or let `var` take the type of the value. A variable declared without a value holds `null` until it is assigned.

```oak
int count = 10;
float ratio = 2.5;
var name = "Ana";
int later;
System.out.println(count, ratio, name, later);
later = 7;
System.out.println(later, typeof name);
```
```output
10 2.5 Ana null
7 string
```

A `{ }` block has its own scope: it sees the names around it and may declare its own, even with the same name. Inside one scope a name can be declared only once; the second declaration is reported and the first one stays.

```oak
int a = 1;
int b = 10;
{
  int b = 20;
  a = 2;
  b = 30;
}
System.out.println(a, b);
int a = 99;
System.out.println(a);
```
```output
2 10
2
```
```problems
9:5 'a' is already declared in this scope
```

A name can *start* with a reserved word (`trueValue`, `nullable`, `format`) but cannot *be* one.

```oak
boolean trueValue = true;
int nullable = 3;
System.out.println(trueValue, nullable);
```
```output
true 3
```

### Conversions

A value can be stored in a wider type: an `int` or a `char` in a `float`, a `char` in an `int`. Anything narrower is a mistake.

```oak
float f = 3;
int code = 'a';
System.out.println(f, code);
int n = 3.5;
```
```output
3.0 97
```
```problems
4:9 cannot assign float to int
```

## Operators

From the tightest to the loosest:

| Operators | Meaning |
|---|---|
| `-x` `!x` `typeof x` | negation, logical not, type name |
| `*` `/` `%` | multiply, divide, remainder |
| `+` `-` | add, subtract (and join strings) |
| `<` `<=` `>` `>=` | order |
| `==` `!=` | equality |
| `&&` | and |
| `\|\|` | or |
| `c ? a : b` | conditional |
| `=` `+=` `-=` | assignment (the loosest, right to left) |

### Numbers

`int` arithmetic is 32-bit and truncates, like Java. `float` arithmetic is decimal. Mixing them gives a `float`.

```oak
System.out.println(7 / 2, -7 / 2, 7 % 3, 7.0 / 2);
System.out.println(2147483647 + 1);
System.out.println(10.5 + 5.5, 10 + 5.5, 0.1 + 0.2);
```
```output
3 -3 1 3.5
-2147483648
16.0 15.5 0.30000000000000004
```

A `float` always prints with a decimal point (`16.0`), and very large or very small ones use the form `1.0E7`. Dividing by zero is a mistake, for `int` and `float` alike.

```oak
System.out.println(1.0 * 20000000, 0.0001);
System.out.println(10 / 0);
```
```output
2.0E7 1.0E-4
null
```
```problems
2:20 division by zero
```

### Text

`+` joins a string with anything. Strings compare by value and by alphabetical order. A `char` counts as a number in arithmetic.

```oak
System.out.println("n = " + 5 + ", ok = " + true);
System.out.println(1 + 2 + "!", "a" == "a", "apple" < "banana");
System.out.println('a' + 1, 'b' - 'a', 'a' == 97);
```
```output
n = 5, ok = true
3! true true
98 1 true
```

### Logic

`&&` and `||` stop as soon as the answer is known, so the right side may be something that would fail.

```oak
int[] list = {1};
System.out.println(false && list[9] > 0, true || list[9] > 0);
boolean ok = 3 > 2 && !(1 == 2);
System.out.println(ok ? "yes" : "no");
```
```output
false true
yes
```

### Assignment, `+=`, `-=`, `++` and `--`

`x += 5` means `x = x + 5`. `++` and `--` add and subtract one; they are statements (and may be the update of a `for`), not parts of a bigger expression.

```oak
int x = 1;
x += 4;
x -= 2;
x++;
x++;
x--;
string s = "a";
s += "b";
System.out.println(x, s);
```
```output
4 ab
```

## Control flow

### if

```oak
int n = 15;
if (n % 15 == 0) {
  System.out.println("fizzbuzz");
} else if (n % 5 == 0) {
  System.out.println("buzz");
} else {
  System.out.println(n);
}
```
```output
fizzbuzz
```

A condition must be a `boolean`; `if (1)` is a mistake, and the statement is skipped.

### while and for

```oak
int i = 0;
while (i < 3) {
  System.out.println("while", i);
  i = i + 1;
}
for (int j = 0; j < 3; j++) {
  if (j == 1) { continue; }
  System.out.println("for", j);
}
```
```output
while 0
while 1
while 2
for 0
for 2
```

`break` leaves the nearest loop (or switch); `continue` skips to its next turn.

```oak
for (int i = 0; i < 3; i++) {
  for (int j = 0; j < 5; j++) {
    if (j == 2) { break; }
    System.out.println(i, j);
  }
}
```
```output
0 0
0 1
1 0
1 1
2 0
2 1
```

### for-each

A for-each walks the elements of an array. Use a type, or `var`.

```oak
int[] primes = {2, 3, 5};
for (int p : primes) {
  System.out.println(p);
}
int[][] grid = {{1, 2}, {3}};
for (var row : grid) {
  System.out.println(row);
}
```
```output
2
3
5
[1, 2]
[3]
```

### switch

A `switch` compares its value with each `case`, in order. From the first match it runs on until a `break` (so cases can share code), and `default` runs when nothing matched.

```oak
for (int day = 1; day <= 4; day++) {
  switch (day) {
    case 1:
    case 2:
      System.out.println(day, "early");
      break;
    case 3:
      System.out.println(day, "middle");
    default:
      System.out.println(day, "late");
  }
}
```
```output
1 early
2 early
3 middle
3 late
4 late
```

## Functions

A function has a return type (`void` for none), a name, typed parameters, and a body. Values are checked: the arguments must fit the parameters and the returned value must fit the return type.

```oak
int add(int a, int b) {
  return a + b;
}
void greet(string who) {
  System.out.println("Hello, " + who);
}
greet("OakLand");
System.out.println(add(2, 3));
```
```output
Hello, OakLand
5
```

A function may be called before the line that declares it, may call itself, and may declare functions of its own, which see the names around them.

```oak
System.out.println(factorial(5));
int factorial(int n) {
  if (n == 0) { return 1; }
  return n * factorial(n - 1);
}
int total(int a, int b) {
  int bonus = 10;
  int inner() { return a + b + bonus; }
  return inner();
}
System.out.println(total(10, 20));
```
```output
120
40
```

Arrays and structs are handed to a function as they are (not copied), so it can change them. Numbers, strings and booleans are copied.

```oak
void fill(int[] a, int n) {
  for (int i = 0; i < a.length; i++) { a[i] = n; }
  n = 99;
}
int[] list = new int[3];
int value = 7;
fill(list, value);
System.out.println(list, value);
```
```output
[7, 7, 7] 7
```

Calling with the wrong number of arguments, the wrong types, or a function that does not exist is reported, as is a function that does not return what it promised.

```oak
int double(int x) { return x * 2; }
System.out.println(double(1, 2));
System.out.println(double("a"));
System.out.println(missing(1));
int nothing() { }
nothing();
```
```output
null
null
null
```
```problems
2:20 'double' expects 1 argument but got 2
3:27 argument 1 of 'double' must be int, but it is string
4:20 function 'missing' is not declared
5:5 'nothing' must return a value of type int
```

Recursion can go about 400 calls deep; beyond that the run stops with a `stack overflow` diagnostic.

## Arrays and matrices

An array is created from a list of values, or with `new` and a size (every element starts as `0`, `0.0`, `""`, `false`, or `null` for structs). More `[]` make a matrix.

```oak
int[] a = {2, 4, 6};
int[] zeros = new int[3];
int[][] grid = new int[2][3];
int[][][] cube = {{{1, 2}, {3, 4}}, {{5, 6}, {7, 8}}};
grid[1][2] = 9;
a[0] = 20;
System.out.println(a, zeros, grid);
System.out.println(cube[1][0][1], a[2]);
```
```output
[20, 4, 6] [0, 0, 0] [[0, 0, 0], [0, 0, 9]]
6 6
```

Arrays have `length`, `indexOf(value)` (or `-1`) and `join()`.

```oak
string[] names = {"Ana", "Luis", "Eva"};
System.out.println(names.length, names.indexOf("Luis"), names.indexOf("Zoe"));
System.out.println(names.join());
```
```output
3 1 -1
Ana, Luis, Eva
```

**Copies.** Declaring an array from another array copies it. Assigning one to an existing variable, or passing it to a function, makes both names refer to the same array.

```oak
int[] a = {1, 2, 3};
int[] copy = a;
int[] other = {0};
other = a;
a[0] = 100;
System.out.println(copy[0], other[0]);
```
```output
1 100
```

An index outside the array is reported with the index and the length.

```oak
int[] a = {1, 2};
System.out.println(a[5]);
a[2] = 3;
```
```output
null
```
```problems
2:22 index 5 is out of range for an array of length 2
3:3 index 2 is out of range for an array of length 2
```

## Structs

A struct groups named, typed fields. It can be used before the line that declares it. Create a value with `Name{field: value, ...}`; fields that are left out are `null`. Read and write a field with a dot.

```oak
struct Pet { string name; }
struct Person { string name; int age; Pet pet; }

Person p = Person{name: "Ana", age: 20, pet: Pet{name: "Rex"}};
p.age = 21;
p.age++;
p.pet.name = "Max";
System.out.println(p.name, p.age, p.pet.name, typeof p);
System.out.println(p);
Person q = Person{name: "Luis"};
System.out.println(q.age, q.pet);
```
```output
Ana 22 Max Person
Person{name: Ana, age: 22, pet: Pet{name: Max}}
null null
```

A struct value is shared, like an array, when it is passed to a function or assigned. An unknown field, or a value of the wrong type, is reported.

```oak
struct Box { int size; }
Box b = Box{size: "big"};
Box c = Box{size: 3};
c.weight = 5;
System.out.println(c.size);
```
```output
3
```
```problems
2:19 the field 'size' of 'Box' must be int, but it is string
4:3 struct 'Box' has no field 'weight'
```

## Built-in functions

| Function | Does |
|---|---|
| `parseInt(s)` | a string such as `"12"` or `"12.9"` to an `int` (cuts the decimals) |
| `parseFloat(s)`, `parsefloat(s)` | a string to a `float` |
| `toString(x)` | a number, boolean or character to a string |
| `toLowerCase(s)`, `toUpperCase(s)` | change the case of a string |
| `time()` | the current date and time as text |
| `obtenerLongitudArray(a)` | the length of an array |

```oak
System.out.println(parseInt("12.9") + 1, parsefloat("2.5") * 2);
System.out.println(toString(10) + toString(2.5), toUpperCase("oak") + toLowerCase("LAND"));
int[] a = {1, 2, 3};
System.out.println(obtenerLongitudArray(a));
int bad = parseInt("twelve");
```
```output
13 5.0
102.5 OAKland
3
```
```problems
5:11 parseInt cannot convert "twelve" to an int
```

## Mistakes

OakLand reports problems instead of crashing. Each one has a position and a phase:

- **lexical** and **syntax**: the text is not a program. All of them (up to 10) are reported and the program does not run.
- **semantic**: the program is well formed but wrong (names, types, arguments).
- **runtime**: something failed while running (index out of range, division by zero, a limit).

Semantic and runtime mistakes do not stop the program: the statement that failed reports it, and the next one runs. A value that could not be stored leaves `null` in the variable, and that does not cause more reports.

```oak
int a = "text";
System.out.println(a);
a = 5;
System.out.println(a + 1);
var s = "x";
s = 10;
System.out.println(s);
System.out.println(undeclared + 1);
```
```output
null
6
null
null
```
```problems
1:9 cannot assign string to int
6:5 cannot assign int to string
8:20 variable 'undeclared' is not declared
```

The same mistake at the same place is listed once, even if a loop repeats it, and a run lists at most 200 problems.

A program with a syntax error does not run at all:

```oak
int x = ;
System.out.println("never printed");
```
```output
```
```problems
1:9 expected an expression, but found ';'
```

## Limits

A run is bounded so that it cannot freeze the page. When a limit is reached the run stops with a diagnostic and keeps what it printed.

| Limit | Value |
|---|---|
| steps (statements and expressions evaluated) | 20,000,000 |
| time | 5 seconds |
| nested calls | 400 |
| characters printed | 200,000 |
| elements in one array | 1,000,000 |
| nesting of blocks and parentheses in the source | 150 |

```oak
System.out.println("start");
while (true) { }
```
```output
start
```
```problems
2:14 step limit reached (20,000,000 steps): the program may be in an infinite loop
```

## Differences from Java

OakLand borrows Java's syntax and arithmetic, but:

- there are no classes, objects, `final`, `static`, `import`, generics, or `String` methods;
- `for` needs its condition and update, and `i++` is a statement;
- a failed assignment leaves `null` in the variable instead of stopping the program;
- arrays have fixed length, `length` is a member without parentheses, and only `length`, `indexOf` and `join` exist;
- `System.out.println` accepts several values;
- structs are values you can write directly: `Person{name: "Ana"}`.
