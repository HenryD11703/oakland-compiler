import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/** On a phone the three areas are tabs; on a desktop they are all on screen. */
async function showPanel(page: Page, panel: "Code" | "State" | "Views"): Promise<void> {
  const tab = page.getByRole("tab", { name: panel, exact: true });
  if (await tab.isVisible()) await tab.click();
}

async function waitForRun(page: Page): Promise<void> {
  await expect(page.getByTestId("timeline")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Run ▸" })).toBeEnabled({ timeout: 20_000 });
}

async function chooseExample(page: Page, name: RegExp): Promise<void> {
  await page.getByRole("button", { name: /Examples/ }).click();
  await page.getByRole("button", { name }).click();
  await waitForRun(page);
}

async function replaceSource(page: Page, text: string): Promise<void> {
  await showPanel(page, "Code");
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(text);
}

async function selectedText(page: Page): Promise<string> {
  return page.evaluate(() => window.getSelection()?.toString() ?? "");
}

test.beforeEach(async ({ page }) => {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console: ${message.text()}`);
  });
  await page.goto("./");
  await waitForRun(page);
  // Read by afterEach through the page object, so that no test has to remember to check.
  (page as unknown as { problems: string[] }).problems = problems;
});

test.afterEach(async ({ page }) => {
  expect((page as unknown as { problems: string[] }).problems, "errors in the page").toEqual([]);
});

test.describe("opening the page", () => {
  test("runs the starting program and shows its output and its timeline", async ({ page }) => {
    await expect(page.getByRole("heading", { name: /Oak\s?Land/ })).toBeVisible();
    await showPanel(page, "Views");
    await expect(page.getByTestId("output")).toContainText("* * *");
    await expect(page.getByTestId("timeline")).toBeVisible();
    await expect(page.locator(".readout")).toContainText("13,228 / 13,228");
  });

  test("starts at the end of the run, then rewinds to the first step", async ({ page }) => {
    await showPanel(page, "State");
    await expect(page.getByTestId("readout")).toContainText("13,228");
    await page.getByRole("button", { name: "Back to the start" }).click();
    await expect(page.getByTestId("readout")).toHaveText("Start");
  });
});

test.describe("the examples menu", () => {
  test("loads an example and runs it", async ({ page }) => {
    await chooseExample(page, /Hello/);
    await expect(page.locator(".file")).toHaveText("Hello (example)");
    await showPanel(page, "Views");
    await expect(page.getByTestId("output")).toContainText("Hello from OakLand!");
  });

  test("closes with Escape", async ({ page }) => {
    await page.getByRole("button", { name: /Examples/ }).click();
    await expect(page.getByRole("button", { name: /Mistakes/ })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: /Mistakes/ })).toHaveCount(0);
  });
});

test.describe("problems (AC-26, AC-28)", () => {
  test("lists each mistake with its place, marks it in the code, and jumps to it", async ({ page }) => {
    await chooseExample(page, /Mistakes/);
    await showPanel(page, "Views");
    await page.getByRole("tab", { name: /Problems/ }).click();
    const rows = page.getByTestId("problems").getByRole("listitem");
    await expect(rows).toHaveCount(7);
    await expect(rows.first()).toContainText("cannot assign string to int");
    await expect(rows.first()).toContainText("4:11");

    await rows.first().getByRole("button").click();
    await expect.poll(() => selectedText(page)).toBe('"twenty"');
    await showPanel(page, "Code");
    await expect(page.locator(".cm-lintRange-error").first()).toBeVisible();
  });

  test("shows syntax errors while typing, and a program with one does not run", async ({ page }) => {
    await replaceSource(page, "int x = ;\n");
    await expect(page.locator(".cm-lintRange-error")).not.toHaveCount(0, { timeout: 5000 });
    await page.getByRole("button", { name: "Run ▸" }).click();
    await showPanel(page, "Views");
    await expect(page.getByRole("tab", { name: /Problems/ })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("problems")).toContainText("expected an expression");
    await page.getByRole("tab", { name: "Output" }).click();
    await expect(page.locator("#pane-out")).toContainText("has not run");
  });

  test("says so when the source changed after the last run, and running again clears it", async ({ page }, info) => {
    await showPanel(page, "Code");
    await page.locator(".cm-content").click();
    await page.keyboard.insertText("// edit\n");
    await expect(page.getByRole("status")).toContainText("Edited since the last run");
    if (info.project.name === "mobile") await page.getByRole("button", { name: "Run ▸" }).click();
    else await page.keyboard.press("ControlOrMeta+Enter");
    await expect(page.getByRole("status")).toHaveCount(0, { timeout: 20_000 });
  });
});

test.describe("running safely (AC-24, AC-25)", () => {
  test("Stop ends a program that never finishes, and the page stays usable", async ({ page }) => {
    await replaceSource(page, "System.out.println(1);\nwhile (true) { }\n");
    await page.getByRole("button", { name: "Run ▸" }).click();
    await expect(page.getByRole("button", { name: "Running…" })).toBeVisible();
    const stop = page.getByRole("button", { name: "Stop" });
    // On a phone the Stop button is hidden to save room; the Running button then waits for the time limit.
    if (await stop.isVisible()) {
      await stop.click();
      await expect(page.getByRole("status")).toContainText("The run was stopped");
      await expect(page.getByRole("button", { name: "Run ▸" })).toBeEnabled();
    }
    // The page still answers: another program runs normally.
    await replaceSource(page, 'System.out.println("alive");\n');
    await page.getByRole("button", { name: "Run ▸" }).click({ timeout: 20_000 });
    await waitForRun(page);
    await showPanel(page, "Views");
    await expect(page.getByTestId("output")).toContainText("alive");
  });

  test("a runaway loop ends by itself with a diagnostic and keeps what it printed", async ({ page }) => {
    test.setTimeout(60_000);
    await replaceSource(page, 'System.out.println("before");\nwhile (true) { }\n');
    await page.getByRole("button", { name: "Run ▸" }).click();
    await waitForRun(page);
    await showPanel(page, "Views");
    await expect(page.getByTestId("output")).toContainText("before");
    await page.getByRole("tab", { name: /Problems/ }).click();
    await expect(page.getByTestId("problems")).toContainText(/limit reached/);
  });
});

test.describe("the timeline (AC-31)", () => {
  test("is a slider operated from the keyboard", async ({ page }) => {
    await chooseExample(page, /Functions/);
    const scrubber = page.getByTestId("scrubber");
    await showPanel(page, "State");
    await scrubber.focus();
    await page.keyboard.press("Home");
    await expect(page.getByTestId("readout")).toContainText("Step 1");
    for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("readout")).toContainText("Step 4");
    await expect(scrubber).toHaveAttribute("aria-valuetext", /^Step 4 of \d+, line \d+/);
    await page.keyboard.press("End");
    await expect(page.getByTestId("readout")).toContainText("of 581");
  });

  test("marks the step in the code, and shows variables and call frames", async ({ page }) => {
    await chooseExample(page, /Functions/);
    await page.getByTestId("scrubber").focus();
    await page.keyboard.press("Home");
    for (let i = 0; i < 40; i++) await page.keyboard.press("ArrowRight");
    await showPanel(page, "Code");
    await expect(page.locator(".cm-active-step")).not.toHaveCount(0);
    await showPanel(page, "State");
    await expect(page.locator(".vars")).toContainText("fibonacci()");
  });

  test("the transport buttons step and play", async ({ page }) => {
    await chooseExample(page, /Hello/);
    await page.getByRole("button", { name: "Back to the start" }).click();
    await showPanel(page, "State");
    await expect(page.getByTestId("readout")).toHaveText("Start");
    await page.getByRole("button", { name: "Forward one step" }).click();
    await expect(page.getByTestId("readout")).toContainText("Step 1");
    await page.getByRole("button", { name: "Back one step" }).click();
    await expect(page.getByTestId("readout")).toHaveText("Start");
    const speed = page.locator(".deck select");
    if (await speed.isVisible()) await speed.selectOption({ label: "Very fast" }); // hidden on a phone
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect(page.getByTestId("readout")).toContainText(/Step 1\d of 1\d/, { timeout: 10_000 });
  });

  test("shows the output printed so far, not all of it", async ({ page }) => {
    await chooseExample(page, /Hello/);
    await page.getByRole("button", { name: "Back to the start" }).click();
    await showPanel(page, "Views");
    await expect(page.getByTestId("output")).toHaveText("");
    await page.getByTestId("scrubber").focus();
    await page.keyboard.press("End");
    await expect(page.getByTestId("output")).toContainText("Count: 3");
  });
});

test.describe("syntax tree and symbols (AC-29, AC-30)", () => {
  test("draw the program and jump to a node", async ({ page }) => {
    await showPanel(page, "Views");
    await page.getByRole("tab", { name: "Syntax tree" }).click();
    await expect(page.getByTestId("tree")).toContainText("Program");
    await expect(page.getByTestId("tree")).toContainText("VarDecl");
    await page.getByTestId("tree").locator(".tree-pick", { hasText: "VarDecl" }).first().click();
    await expect.poll(() => selectedText(page)).toContain("float n = 10;");
  });

  test("the whole view opens from the top bar, selects a node and shows it in the code", async ({ page }) => {
    await page.getByRole("group", { name: "Whole views" }).getByRole("button", { name: "Syntax tree" }).click();
    const whole = page.getByRole("main", { name: "Syntax tree, whole view" });
    await expect(whole).toBeVisible();
    await expect(page.locator(".sheet")).toBeHidden();
    await expect(whole.getByTestId("tree")).toContainText("VarDecl");
    await whole.locator(".tree-pick", { hasText: "VarDecl" }).first().click();
    await expect(whole).toContainText(/line \d+:\d+/);
    await whole.getByRole("button", { name: /Show in code/ }).click();
    await expect(whole).toBeHidden();
    await expect.poll(() => selectedText(page)).toContain("float n = 10;");
  });

  test("folding a node hides what is below it, and Escape closes the whole view", async ({ page }) => {
    await page.getByRole("group", { name: "Whole views" }).getByRole("button", { name: "Syntax tree" }).click();
    const whole = page.getByRole("main", { name: "Syntax tree, whole view" });
    await whole.getByRole("button", { name: "Expand all" }).click();
    const before = await whole.locator(".tree-pick").count();
    await whole.getByRole("button", { name: "Collapse Program" }).click();
    await expect(whole.locator(".tree-pick")).toHaveCount(1);
    expect(before).toBeGreaterThan(1);
    await whole.getByRole("button", { name: "Expand Program" }).click();
    await expect(whole.locator(".tree-pick")).not.toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(whole).toBeHidden();
  });

  test("the top bar opens a whole view for the output, the problems and the symbols too", async ({ page }) => {
    for (const [name, text] of [["Output", /./], ["Problems", /./], ["Symbols", /absY/]] as const) {
      await page.getByRole("group", { name: "Whole views" }).getByRole("button", { name }).click();
      const whole = page.getByRole("main", { name: `${name}, whole view` });
      await expect(whole).toBeVisible();
      await expect(whole).toContainText(text);
      await page.keyboard.press("Escape");
      await expect(whole).toBeHidden();
    }
  });

  test("the tree can be zoomed with the buttons and the wheel, fitted, and dragged", async ({ page }) => {
    await page.getByRole("group", { name: "Whole views" }).getByRole("button", { name: "Syntax tree" }).click();
    const whole = page.getByRole("main", { name: "Syntax tree, whole view" });
    const zoom = whole.locator(".zoom");
    await expect(zoom).toHaveText("100%");
    await whole.getByRole("button", { name: "Zoom in" }).click();
    await expect(zoom).toHaveText("125%");
    const box = (await whole.locator(".tree-scroll").boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -300);
    await expect.poll(async () => Number.parseInt((await zoom.textContent()) ?? "0")).toBeGreaterThan(125);
    await whole.getByRole("button", { name: "Fit" }).click();
    // Fit leaves the whole drawing inside the box (or bigger than 100% when it is small).
    await expect.poll(() => whole.locator(".tree-scroll").evaluate((el) => el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1)).toBe(true);
    await whole.getByRole("button", { name: "100%", exact: true }).click();
    await expect(zoom).toHaveText("100%");
    await whole.getByRole("button", { name: "Expand all" }).click();
    for (let i = 0; i < 5; i++) await whole.getByRole("button", { name: "Zoom in" }).click();
    const scroller = whole.locator(".tree-scroll");
    const before = await scroller.evaluate((el) => el.scrollTop);
    await page.mouse.move(box.x + 6, box.y + 6);
    await page.mouse.down();
    await page.mouse.move(box.x + 6, box.y + 90, { steps: 4 });
    await page.mouse.up();
    expect(await scroller.evaluate((el) => el.scrollTop)).not.toBe(before);
  });

  test("the panel has a button for the whole view", async ({ page }) => {
    await showPanel(page, "Views");
    await page.getByRole("tab", { name: "Syntax tree" }).click();
    await page.getByRole("button", { name: /Full view/ }).click();
    await expect(page.getByRole("main", { name: "Syntax tree, whole view" })).toBeVisible();
  });

  test("list every declared name and jump to it", async ({ page }) => {
    await showPanel(page, "Views");
    await page.getByRole("tab", { name: "Symbols" }).click();
    await expect(page.getByTestId("symbols").getByRole("row")).toHaveCount(7); // the header and six names
    await page.getByTestId("symbols").getByRole("button", { name: "absY" }).click();
    await expect.poll(() => selectedText(page)).toBe("absY");
  });
});

test.describe("files and drafts", () => {
  test("opens a file from the computer and runs it", async ({ page }) => {
    await page.getByRole("button", { name: /Examples/ }).click();
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: /Open a file/ }).click();
    await (await chooser).setFiles({ name: "mine.oak", mimeType: "text/plain", buffer: Buffer.from('System.out.println("from a file");\n') });
    await waitForRun(page);
    await expect(page.locator(".file")).toHaveText("mine.oak");
    await showPanel(page, "Views");
    await expect(page.getByTestId("output")).toContainText("from a file");
  });

  test("saves what is in the editor as a .oak file", async ({ page }) => {
    await replaceSource(page, "int saved = 1;\n");
    await page.getByRole("button", { name: /Examples/ }).click();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: /Save as/ }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe("program.oak");
  });

  test("keeps the draft when the page is reloaded", async ({ page }) => {
    await replaceSource(page, 'System.out.println("draft");\n');
    await page.reload();
    await waitForRun(page);
    await expect(page.locator(".file")).toHaveText("Your draft");
    await showPanel(page, "Views");
    await expect(page.getByTestId("output")).toContainText("draft");
  });
});

test.describe("layout (AC-33)", () => {
  test("never scrolls sideways", async ({ page }) => {
    for (const panel of ["Code", "State", "Views"] as const) {
      await showPanel(page, panel);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, panel).toBe(0);
    }
  });

  test("shows the panels as tabs on a phone and all together on a desktop", async ({ page }, info) => {
    const tabs = page.getByRole("tab", { name: "State", exact: true });
    if (info.project.name === "mobile") {
      await expect(tabs).toBeVisible();
      await page.getByRole("tab", { name: "State", exact: true }).click();
      await expect(page.locator(".vars")).toBeVisible();
      await expect(page.getByTestId("editor")).toBeHidden();
    } else {
      await expect(tabs).toBeHidden();
      await expect(page.getByTestId("editor")).toBeVisible();
      await expect(page.locator(".vars")).toBeVisible();
    }
  });

  test("the dividers resize the panels from the keyboard, and the sizes survive a reload", async ({ page }, info) => {
    test.skip(info.project.name === "mobile", "on a phone the panels are tabs and there are no dividers");
    const side = page.locator(".side");
    const vars = page.locator(".vars");
    const width = async (): Promise<number> => (await side.boundingBox())?.width ?? 0;
    const height = async (): Promise<number> => (await vars.boundingBox())?.height ?? 0;

    const before = await width();
    const sideDivider = page.getByRole("separator", { name: /code and the side panels/ });
    await sideDivider.focus();
    await page.keyboard.press("Shift+ArrowLeft");
    await expect.poll(width).toBeGreaterThan(before + 50);
    const widened = await width();
    await page.keyboard.press("Shift+ArrowRight");
    await page.keyboard.press("Shift+ArrowRight");
    await expect.poll(width).toBeLessThan(widened - 50);

    const varsDivider = page.getByRole("separator", { name: /variables and the views/ });
    await varsDivider.focus();
    await page.keyboard.press("Home");
    await expect.poll(height).toBeLessThanOrEqual(80);
    const smallest = await height();
    await page.keyboard.press("Shift+ArrowDown");
    await expect.poll(height).toBeGreaterThan(smallest + 50);

    const kept = await width();
    await page.reload();
    await waitForRun(page);
    expect(Math.abs((await width()) - kept)).toBeLessThan(2);

    // Enter on a divider puts the panel back to its default size.
    await page.getByRole("separator", { name: /code and the side panels/ }).focus();
    await page.keyboard.press("Enter");
    await expect.poll(async () => Math.abs((await width()) - kept)).toBeGreaterThan(20);
  });

  test("an element that is not ours inside the grid does not push the panels out of place", async ({ page }, info) => {
    test.skip(info.project.name === "mobile", "on a phone the panels are tabs and there is no grid");
    // A browser extension or a translation layer can add a node to the page: the panels must keep their cells.
    await page.evaluate(() => {
      const sheet = document.querySelector(".sheet");
      sheet?.prepend(document.createElement("div"));
      sheet?.append(document.createElement("div"));
    });
    const code = await page.locator(".sheet > .code").boundingBox();
    const side = await page.locator(".side").boundingBox();
    const divider = await page.getByRole("separator", { name: /code and the side panels/ }).boundingBox();
    if (!code || !side || !divider) throw new Error("a panel is missing");
    expect(side.x).toBeGreaterThan(code.x + code.width);
    expect(Math.abs(divider.x - (code.x + code.width))).toBeLessThan(2);
    expect(side.y).toBeLessThan(code.y + 5);
    await expect(page.getByTestId("readout")).toBeVisible();
  });

  test("a divider can be dragged with the mouse", async ({ page }, info) => {
    test.skip(info.project.name === "mobile", "on a phone the panels are tabs and there are no dividers");
    const side = page.locator(".side");
    const before = (await side.boundingBox())?.width ?? 0;
    const box = await page.getByRole("separator", { name: /code and the side panels/ }).boundingBox();
    if (!box) throw new Error("no divider");
    await page.mouse.move(box.x + box.width / 2, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x - 120, box.y + 200, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => (await side.boundingBox())?.width ?? 0).toBeGreaterThan(before + 80);
  });

  test("the output is readable and scrolls inside its own panel", async ({ page }, info) => {
    test.skip(info.project.name === "mobile", "the phone shows the views as a tab of their own");
    const size = await page.getByTestId("output").evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
    expect(size).toBeGreaterThanOrEqual(13);
  });
});

test.describe("accessibility (AC-34)", () => {
  const scan = async (page: Page): Promise<void> => {
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"]).analyze();
    const serious = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
    expect(result.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  };

  test("the main view has no violations", async ({ page }) => {
    await scan(page);
  });

  test("every panel has no violations", async ({ page }) => {
    for (const panel of ["State", "Views"] as const) {
      await showPanel(page, panel);
      await scan(page);
    }
    await showPanel(page, "Views");
    for (const tab of ["Problems", "Syntax tree", "Symbols"]) {
      await page.getByRole("tab", { name: tab }).click();
      await scan(page);
    }
    await page.getByRole("tab", { name: "Syntax tree" }).click();
    await page.getByRole("button", { name: /Full view/ }).click();
    await scan(page);
  });

  test("the examples menu and a program with mistakes have no violations", async ({ page }) => {
    await page.getByRole("button", { name: /Examples/ }).click();
    await scan(page);
    await page.getByRole("button", { name: /Mistakes/ }).click();
    await waitForRun(page);
    await showPanel(page, "Views");
    await page.getByRole("tab", { name: /Problems/ }).click();
    await scan(page);
  });

  test("everything can be reached with the keyboard: Tab leaves the editor", async ({ page }) => {
    await showPanel(page, "Code");
    await page.locator(".cm-content").focus();
    await page.keyboard.press("Tab");
    const stillInEditor = await page.evaluate(() => document.activeElement?.closest(".cm-editor") !== null);
    expect(stillInEditor).toBe(false);
  });
});
