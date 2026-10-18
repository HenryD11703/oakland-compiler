import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/** On a phone the areas are tabs (Code, WebAssembly, Results); on a desktop they are all on screen. */
async function showPanel(page: Page, panel: "Code" | "WebAssembly" | "Results"): Promise<void> {
  const tab = page.getByRole("tab", { name: panel, exact: true });
  if (await tab.isVisible()) await tab.click();
}

async function waitForRun(page: Page): Promise<void> {
  await expect(page.getByTestId("timeline")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Run ▸" })).toBeEnabled({ timeout: 20_000 });
}

const mode = (page: Page, name: "Interpret" | "Compile") => page.getByRole("group", { name: "Mode" }).getByRole("button", { name });

async function pickSieve(page: Page): Promise<void> {
  await page.getByRole("button", { name: /Examples/ }).click();
  await page.getByRole("button", { name: /Sieve/ }).click();
  await waitForRun(page);
}

async function compileSieve(page: Page): Promise<void> {
  await pickSieve(page);
  await mode(page, "Compile").click();
  await page.getByRole("button", { name: "Compile ▸" }).click();
  await showPanel(page, "WebAssembly");
  await expect(page.getByTestId("wasm")).toContainText("$main");
}

async function replaceSource(page: Page, text: string): Promise<void> {
  await showPanel(page, "Code");
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(text);
}

const selectedText = (page: Page): Promise<string> => page.evaluate(() => window.getSelection()?.toString() ?? "");

test.beforeEach(async ({ page }) => {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console: ${message.text()}`);
  });
  await page.goto("./");
  await waitForRun(page);
  (page as unknown as { problems: string[] }).problems = problems;
});

test.afterEach(async ({ page }) => {
  expect((page as unknown as { problems: string[] }).problems, "errors in the page").toEqual([]);
});

test.describe("Compile mode (S-23 to S-25)", () => {
  test("pick Sieve, Compile, see the WebAssembly, Compare: by mouse", async ({ page }) => {
    await compileSieve(page);
    await expect(page.getByTestId("module-bytes")).toContainText("586");
    await expect(page.getByTestId("wasm").locator('[data-fn="rt:alloc"]')).toBeVisible();
    await showPanel(page, "Results");
    await expect(page.getByTestId("under-output")).toHaveText("17984");
    await page.getByRole("button", { name: /Compare/ }).click();
    const compare = page.getByTestId("compare");
    await expect(compare).toContainText("the outputs are identical", { timeout: 20_000 });
    await expect(compare).toContainText(/\d+×/);
    await expect(compare.getByText("Interpret", { exact: true })).toBeVisible();
    await compare.getByRole("button", { name: /Close/ }).click();
    await expect(page.getByTestId("compare")).toHaveCount(0);
    await expect(page.getByTestId("module-bytes")).toBeVisible();
  });

  test("the same flow from the keyboard", async ({ page, isMobile }) => {
    await pickSieve(page);
    await mode(page, "Compile").focus();
    await page.keyboard.press("Enter");
    await expect(mode(page, "Compile")).toHaveAttribute("aria-pressed", "true");
    if (isMobile) await page.getByRole("button", { name: "Compile ▸" }).click(); // the emulated phone does not send Ctrl+Enter to the editor
    else {
      await page.locator(".cm-content").click();
      await page.keyboard.press("ControlOrMeta+Enter"); // runs the current mode
    }
    await showPanel(page, "WebAssembly");
    await expect(page.getByTestId("wasm")).toContainText("$main");
    await page.getByRole("button", { name: /Compare/ }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("compare")).toContainText("the outputs are identical", { timeout: 20_000 });
  });

  test("a function opens and folds, and says which source lines it came from", async ({ page }) => {
    await compileSieve(page);
    const main = page.getByTestId("wasm").locator('[data-fn="main"]');
    await expect(main.getByRole("button", { name: /\$main/ })).toHaveAttribute("aria-expanded", "true");
    await main.getByRole("button", { name: /\$main/ }).click();
    await expect(main.getByRole("button", { name: /\$main/ })).toHaveAttribute("aria-expanded", "false");
    const alloc = page.getByTestId("wasm").locator('[data-fn="rt:alloc"]');
    await expect(alloc.getByRole("button", { name: /alloc/ })).toHaveAttribute("aria-expanded", "false");
    await alloc.getByRole("button", { name: /alloc/ }).click();
    await expect(alloc).toContainText("memory.grow");
    await expect(alloc.getByRole("button", { name: /source line/ })).toHaveCount(0); // the runtime has no source
    await page.getByRole("button", { name: "Unfold all", exact: true }).click();
    await expect(page.getByRole("button", { name: "Fold all", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Fold all", exact: true }).click();
    await expect(page.getByRole("button", { name: "Unfold all", exact: true })).toBeVisible();
  });

  test("a function points at its source, and the source selects its lines", async ({ page }) => {
    await compileSieve(page);
    await page.getByRole("button", { name: /← source lines 1–13/ }).click();
    await expect.poll(() => selectedText(page)).toContain("System.out.println(count);");
    expect(await selectedText(page)).toContain("int n = 200000;");
  });

  test("a line of the source opens its function", async ({ page, isMobile }) => {
    test.skip(isMobile, "the code and the WebAssembly are separate tabs on a phone");
    await replaceSource(page, "int twice(int x) {\n  return x * 2;\n}\nint thrice(int x) {\n  return x * 3;\n}\nSystem.out.println(twice(2) + thrice(2));");
    await mode(page, "Compile").click();
    await page.getByRole("button", { name: "Compile ▸" }).click();
    await expect(page.getByTestId("wasm")).toContainText("$thrice");
    await page.getByRole("button", { name: "Fold all", exact: true }).click(); // this program has no runtime functions, so all of them are open
    const thrice = page.getByTestId("wasm").locator('[data-fn="thrice"]');
    await expect(thrice.getByRole("button", { name: /\$thrice/ })).toHaveAttribute("aria-expanded", "false");
    await page.locator(".cm-line").nth(4).click(); // `return x * 3;`
    await expect(thrice.getByRole("button", { name: /\$thrice/ })).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("wasm").locator('[data-fn="twice"]').getByRole("button", { name: /\$twice/ })).toHaveAttribute("aria-expanded", "false");
  });

  test("a program with mistakes is not compiled, and says why", async ({ page }) => {
    await replaceSource(page, 'int x = "no";\nSystem.out.println(x);');
    await mode(page, "Compile").click();
    await page.getByRole("button", { name: "Compile ▸" }).click();
    await showPanel(page, "WebAssembly");
    await expect(page.getByText(/The program was not compiled/)).toBeVisible();
    await showPanel(page, "Results");
    await expect(page.getByTestId("problems")).toContainText("cannot assign string to int");
  });

  test("the output of a compiled program keeps what it printed before its mistake", async ({ page }) => {
    await replaceSource(page, 'System.out.println("before");\nint z = 0;\nSystem.out.println(10 / z);');
    await mode(page, "Compile").click();
    await page.getByRole("button", { name: "Compile ▸" }).click();
    await showPanel(page, "Results");
    await expect(page.getByTestId("under-output")).toHaveText("before");
    await page.locator("button.under").click(); // the line under the WebAssembly opens the drawer
    await page.getByRole("tab", { name: "Problems" }).click();
    await expect(page.getByTestId("problems")).toContainText("division by zero");
  });

  test("switching back to Interpret brings the timeline back", async ({ page }) => {
    await compileSieve(page);
    await expect(page.getByTestId("timeline")).toHaveCount(0);
    await mode(page, "Interpret").click();
    await page.getByRole("button", { name: "Run ▸" }).click();
    await expect(page.getByTestId("timeline")).toBeVisible({ timeout: 20_000 });
  });

  test("the whole views work in Compile mode, and Symbols is only offered in Interpret", async ({ page }) => {
    await compileSieve(page);
    const views = page.getByRole("group", { name: "Whole views" });
    await expect(views.getByRole("button", { name: "Symbols" })).toHaveCount(0);
    await views.getByRole("button", { name: "Output" }).click();
    await expect(page.getByRole("main", { name: "Output, whole view" })).toContainText("17984");
    await page.keyboard.press("Escape");
    await views.getByRole("button", { name: "Syntax tree" }).click();
    await expect(page.getByRole("main", { name: "Syntax tree, whole view" })).toContainText("Program");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("module-bytes")).toBeVisible();
  });
});

test.describe("a compiled program that never ends (S-20, S-26)", () => {
  test("Stop ends it and the page stays usable", async ({ page, isMobile }) => {
    test.skip(isMobile, "Stop is not shown on a phone; the timeout test below covers it");
    await replaceSource(page, "System.out.println(1);\nwhile (true) { }");
    await mode(page, "Compile").click();
    await page.getByRole("button", { name: "Compile ▸" }).click();
    await expect(page.getByRole("button", { name: "Compiling…" })).toBeDisabled();
    await page.getByRole("button", { name: "Stop" }).click();
    await expect(page.getByRole("button", { name: "Compile ▸" })).toBeEnabled();
    await expect(page.getByRole("status")).toContainText("stopped");
    // usable: another program compiles and runs
    await replaceSource(page, "System.out.println(2 + 2);");
    await page.getByRole("button", { name: "Compile ▸" }).click();
    await showPanel(page, "Results");
    await expect(page.getByTestId("under-output")).toHaveText("4", { timeout: 15_000 });
  });

  test("the hard timeout ends it by itself", async ({ page }) => {
    test.setTimeout(60_000);
    await replaceSource(page, "while (true) { }");
    await mode(page, "Compile").click();
    await page.getByRole("button", { name: "Compile ▸" }).click();
    await expect(page.getByRole("status")).toContainText("stopped after 5 seconds", { timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Compile ▸" })).toBeEnabled();
    await replaceSource(page, "System.out.println(7);");
    await page.getByRole("button", { name: "Compile ▸" }).click();
    await showPanel(page, "Results");
    await expect(page.getByTestId("under-output")).toHaveText("7", { timeout: 15_000 });
  });
});

test.describe("accessibility of the new panels (S-27)", () => {
  const scan = async (page: Page): Promise<void> => {
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"]).analyze();
    expect(result.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  };

  test("the mode switch, the WebAssembly, the output line, the ledger and the comparison have no violations", async ({ page }) => {
    await scan(page); // the mode switch in Interpret mode
    await compileSieve(page);
    await scan(page);
    await showPanel(page, "Results");
    await page.locator("button.under").click();
    await scan(page);
    await page.getByRole("button", { name: /Compare/ }).click();
    await expect(page.getByTestId("compare")).toContainText("the outputs are identical", { timeout: 20_000 });
    await scan(page);
  });

  test("a program with mistakes, and the whole views of Compile mode, have no violations", async ({ page }) => {
    await replaceSource(page, 'int x = "no";');
    await mode(page, "Compile").click();
    await page.getByRole("button", { name: "Compile ▸" }).click();
    await showPanel(page, "WebAssembly");
    await expect(page.getByText(/The program was not compiled/)).toBeVisible();
    await scan(page);
    await page.getByRole("group", { name: "Whole views" }).getByRole("button", { name: "Problems" }).click();
    await scan(page);
  });
});
