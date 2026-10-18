/* global document */
// Takes the screenshots of the Compile-mode mockups (task T55) into docs/design/compiler/images/.
//   node scripts/mockup-compiler-shots.mjs [a|b|c]
import { chromium } from "@playwright/test";
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const dir = resolve(import.meta.dirname, "..", "docs", "design", "compiler");
const only = process.argv[2];
const pages = readdirSync(dir).filter((f) => /^[abc]-.*\.html$/.test(f) && (!only || f.startsWith(only)));
const sizes = [["1280", { width: 1280, height: 800 }], ["375", { width: 375, height: 812 }]];
const browser = await chromium.launch();
for (const file of pages) {
  for (const [label, viewport] of sizes) {
    for (const state of ["compile", "compare"]) {
      const page = await browser.newPage({ viewport });
      await page.goto(`${pathToFileURL(join(dir, file)).href}#${state}`);
      await page.waitForTimeout(400);
      await page.evaluate(() => document.querySelector(".caption")?.remove()); // the switch for whoever browses the mockup is not part of the design
      const name = `${file[0]}-${state}-${label}.png`;
      await page.screenshot({ path: join(dir, "images", name) });
      await page.close();
      console.log(name);
    }
  }
}
await browser.close();
