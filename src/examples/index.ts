import animals from "./animals.oak?raw";
import arrays from "./arrays.oak?raw";
import bankAccount from "./bank-account.oak?raw";
import basics from "./basics.oak?raw";
import controlFlow from "./control-flow.oak?raw";
import functions from "./functions.oak?raw";
import hello from "./hello.oak?raw";
import linkedList from "./linked-list.oak?raw";
import heart from "./heart.oak?raw";
import mistakes from "./mistakes.oak?raw";
import structs from "./structs.oak?raw";

export interface Example {
  readonly id: string;
  readonly title: string;
  /** One line that says what to look at. */
  readonly blurb: string;
  readonly source: string;
}

export const EXAMPLES: readonly Example[] = [
  { id: "hello", title: "Hello", blurb: "A first program with a loop.", source: hello },
  { id: "basics", title: "Basics", blurb: "Types, operators and strings.", source: basics },
  { id: "control-flow", title: "Control flow", blurb: "if, while, for, for-each, switch.", source: controlFlow },
  { id: "arrays", title: "Arrays", blurb: "Arrays, matrices, copies.", source: arrays },
  { id: "functions", title: "Functions", blurb: "Recursion and the call stack.", source: functions },
  { id: "structs", title: "Structs", blurb: "Named fields and shared values.", source: structs },
  { id: "animals", title: "Animals", blurb: "Classes, inheritance and overriding: the object decides.", source: animals },
  { id: "bank-account", title: "Bank account", blurb: "Private fields and methods that guard them.", source: bankAccount },
  { id: "linked-list", title: "Linked list", blurb: "Objects that point to objects, and reversing them.", source: linkedList },
  { id: "heart", title: "Heart", blurb: "Nested loops: 13,000 steps to replay.", source: heart },
  { id: "mistakes", title: "Mistakes", blurb: "Seven mistakes, each reported with its position.", source: mistakes },
];

/** What opens first: the one that shows the timeline best. */
export const DEFAULT_EXAMPLE = EXAMPLES.find((e) => e.id === "heart") as Example;
