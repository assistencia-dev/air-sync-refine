import { defineConfig, devices } from "@playwright/test";

const baseURL = (process.env.DBS_E2E_BASE_URL || "http://127.0.0.1:4173").trim();

if (/air-sync-refine\.lovable\.app/i.test(baseURL)) {
  throw new Error(
    "DBS_E2E_BASE_URL aponta para o domínio de produção. Use uma prévia/base de teste isolada.",
  );
}

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]]
    : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
  },
});
