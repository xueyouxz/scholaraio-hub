import { defineConfig, devices } from "@playwright/test";
import { resolveDerivedPorts } from "./packages/shared/src/ports";

const ports = resolveDerivedPorts(process.env);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${ports.preview}`,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
      },
    },
  ],
  webServer: {
    command: `pnpm --filter @scholaraio-hub/client preview --host 127.0.0.1 --port ${ports.preview}`,
    port: ports.preview,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
