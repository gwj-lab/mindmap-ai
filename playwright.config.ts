import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 45_000,
  workers: 1,
  reporter: "line",
  outputDir: "test-results"
});
