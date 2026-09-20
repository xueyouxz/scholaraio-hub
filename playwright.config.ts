import { defineConfig, devices } from "@playwright/test";
import { resolveDerivedPorts } from "./packages/shared/src/ports";

const port = resolveDerivedPorts(process.env).app + 100;
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "pnpm --filter @scholaraio-hub/server exec tsx test/e2e/workbench-server.ts",
    env: { PORT: String(port), NODE_ENV: "test" },
    port,
    reuseExistingServer: false,
    timeout: 120000,
  },
});
