import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { resolveDerivedPorts } from "./packages/shared/src/ports";

const ports = resolveDerivedPorts(process.env);
const e2ePorts = {
  app: ports.app + 100,
  preview: ports.preview + 100,
};
const host = "127.0.0.1";
const serverContractFixturesDir = path.resolve("e2e/fixtures/server-contract/claude-projects");
const serverContractDataDir = path.resolve(".playwright/server-contract-data");
const serverContractCodexDir = path.resolve(".playwright/server-contract-codex");

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  projects: [
    {
      name: "frontend-mock-smoke",
      testMatch: /frontend\.mock\.smoke\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: `http://${host}:${e2ePorts.preview}`,
        trace: "on-first-retry",
      },
    },
    {
      name: "server-contract-smoke",
      testMatch: /server\.contract\.smoke\.spec\.ts/,
      use: {
        baseURL: `http://${host}:${e2ePorts.app}`,
        trace: "on-first-retry",
      },
    },
  ],
  webServer: [
    {
      command: `pnpm --filter @scholaraio-hub/client preview --host ${host} --port ${e2ePorts.preview}`,
      port: e2ePorts.preview,
      reuseExistingServer: false,
      timeout: 120000,
    },
    {
      command: `HOST=${host} PORT=${e2ePorts.app} SCHOLARAIO_HUB_DATA_DIR=${serverContractDataDir} CLAUDE_PROJECTS_DIR=${serverContractFixturesDir} CODEX_SESSIONS_DIR=${serverContractCodexDir} ENABLED_PROVIDERS=claude pnpm --filter @scholaraio-hub/server dev:mock`,
      port: e2ePorts.app,
      reuseExistingServer: false,
      timeout: 120000,
    },
  ],
});
