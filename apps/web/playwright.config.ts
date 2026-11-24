import { defineConfig, devices } from "@playwright/test";

/*
 * The end-to-end runs open the static export in demo mode: the whole product with PostgreSQL in
 * the page, no server. Build it first (`pnpm build` here, or `pnpm build:web` at the root); this
 * config serves `out/` statically. The first page of each run loads the engine and the seed,
 * which is why the expectations wait longer than a form usually needs.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 45_000 },
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:4175",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: "pnpm exec serve -s out -l 4175 --no-clipboard --no-request-logging",
    url: "http://localhost:4175/sign-in",
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
