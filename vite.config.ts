import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// The site is served from https://henryd11703.github.io/OLC2_Proyecto1_202004071/ (GitHub Pages),
// so production assets live under that path. `npm run dev` serves from "/".
export default defineConfig(({ command, isPreview }) => ({
  // `vite preview` serves the production build, so it must use the production base too.
  base: command === "build" || isPreview ? "/OLC2_Proyecto1_202004071/" : "/",
  plugins: [react()],
  build: { target: "es2022" },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
}));
