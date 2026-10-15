// Takes the screenshots used in README.md from the production build.
//
//   npm run build && npx vite preview --port 3100 --strictPort    (in another terminal)
//   npm run screenshots
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const url = process.env.OAKLAND_URL ?? "http://localhost:3100/OLC2_Proyecto1_202004071/";
const out = join(import.meta.dirname, "..", "docs", "images");
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();

async function open(size, scale = 1) {
  const context = await browser.newContext({ viewport: size, deviceScaleFactor: scale });
  const page = await context.newPage();
  await page.goto(url);
  await page.getByTestId("timeline").waitFor({ timeout: 20_000 });
  await page.getByRole("button", { name: "Run ▸" }).waitFor();
  return { context, page };
}

// Desktop: the heart program, part of the way through.
{
  const { context, page } = await open({ width: 1280, height: 800 });
  const box = await page.getByTestId("scrubber").boundingBox();
  if (box) await page.mouse.click(box.x + box.width * 0.32, box.y + 20);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(out, "playground.png") });
  await context.close();
}

// Desktop: mistakes reported with positions.
{
  const { context, page } = await open({ width: 1280, height: 800 });
  await page.getByRole("button", { name: /Examples/ }).click();
  await page.getByRole("button", { name: /Mistakes/ }).click();
  await page.getByRole("button", { name: "Run ▸" }).waitFor();
  await page.getByRole("tab", { name: /Problems/ }).click();
  await page.locator('[data-testid="problems"] button').first().click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(out, "mistakes.png") });
  await context.close();
}

// Desktop: a recursive call stack.
{
  const { context, page } = await open({ width: 1280, height: 800 });
  await page.getByRole("button", { name: /Examples/ }).click();
  await page.getByRole("button", { name: /Functions/ }).click();
  await page.getByRole("button", { name: "Run ▸" }).waitFor();
  await page.getByTestId("scrubber").focus();
  await page.keyboard.press("Home");
  for (let i = 0; i < 12; i++) await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(out, "call-stack.png") });
  await context.close();
}

// Phone, 375 px wide.
{
  const { context, page } = await open({ width: 375, height: 812 }, 2);
  await page.screenshot({ path: join(out, "phone-code.png") });
  await page.getByRole("tab", { name: "State", exact: true }).click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(out, "phone-state.png") });
  await context.close();
}

await browser.close();
console.log(`screenshots written to ${out}`);
