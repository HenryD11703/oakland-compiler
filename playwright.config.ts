import { defineConfig, devices } from "@playwright/test";

// Port 3100 is reserved for the production preview used by the E2E tests.
// Kill any server on it before running: Playwright would otherwise reuse a stale build.
export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 2,
  retries: 0,
  use: { baseURL: "http://localhost:3100/", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    { name: "mobile", use: { ...devices["Pixel 7"], viewport: { width: 375, height: 812 } } },
  ],
  webServer: {
    command: "npm run build && npm run preview",
    url: "http://localhost:3100/",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
