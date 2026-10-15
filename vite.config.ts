import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import type { HtmlTagDescriptor, Plugin } from "vite";
import { defineConfig } from "vitest/config";

const escapeHtml = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Two things for the first paint:
 * - the starting program (src/examples/heart.oak, the default example) goes into index.html as plain text,
 *   so that it is on screen before any script has run;
 * - the two Latin font files are preloaded, so the text is not painted twice (system font, then OakLand's).
 */
function firstPaint(): Plugin {
  return {
    name: "oakland-first-paint",
    transformIndexHtml: {
      order: "post",
      handler(html, context) {
        const source = readFileSync(new URL("./src/examples/heart.oak", import.meta.url), "utf8");
        const tags: HtmlTagDescriptor[] = [];
        for (const file of Object.keys(context.bundle ?? {})) {
          if (/(instrument-sans|spline-sans-mono)-latin-wght-normal.*\.woff2$/.test(file)) {
            tags.push({ tag: "link", attrs: { rel: "preload", as: "font", type: "font/woff2", crossorigin: "", href: `${context.server ? "/" : "./"}${file}` }, injectTo: "head" });
          }
        }
        return { html: html.replace("<!--shell-code-->", escapeHtml(source.replace(/\r\n/g, "\n"))), tags };
      },
    },
  };
}

// The site is served from https://henryd11703.github.io/OLC2_Proyecto1_202004071/ (GitHub Pages),
// so production assets live under that path. `npm run dev` serves from "/".
export default defineConfig(({ command, isPreview }) => ({
  // `vite preview` serves the production build, so it must use the production base too.
  base: command === "build" || isPreview ? "/OLC2_Proyecto1_202004071/" : "/",
  plugins: [react(), firstPaint()],
  build: { target: "es2022" },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
}));
