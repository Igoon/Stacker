import { defineConfig, devices } from "@playwright/test";

// E2E untuk PWA: uji alur nyata di Chrome (OPFS + worker + service worker).
// Memakai Chrome yang sudah terpasang (`channel: "chrome"`), tanpa unduh browser.
export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5199",
    channel: "chrome",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: "npm run dev -- --port 5199 --strictPort",
    url: "http://localhost:5199",
    reuseExistingServer: true,
    timeout: 90_000,
  },
});
