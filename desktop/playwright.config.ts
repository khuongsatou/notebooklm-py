import { defineConfig, devices } from "@playwright/test";

const testPort = process.env.NOTEBOOKLM_DESKTOP_TEST_PORT || "5173";
const testBaseUrl = `http://127.0.0.1:${testPort}`;

export default defineConfig({
  testDir: "./tests",
  outputDir: "./test-results",
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  use: {
    baseURL: testBaseUrl,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium-1440",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "chromium-1280",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 760 } },
    },
    {
      name: "chromium-1100",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1100, height: 760 } },
    },
    {
      name: "chromium-900",
      use: { ...devices["Desktop Chrome"], viewport: { width: 900, height: 760 } },
    },
  ],
  webServer: {
    command: `npm run dev -- --port ${testPort}`,
    url: testBaseUrl,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
