/**
 * Every test file starts from an environment of its own: none of the Hub's
 * variables or provider credentials from the shell that ran the tests, and a
 * throwaway HOME, so no test reads or writes the developer's ~/.claude or
 * ~/.codex. The opt-in suites that drive a real, logged-in CLI keep the real
 * environment.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll } from "vitest";
import { HUB_ENV_KEYS } from "../../src/env.js";

const REAL_SUITES = ["REAL_SDK_TESTS", "REAL_HUB_TESTS", "REAL_CODEX_TESTS"];
/** What would point a provider at the developer's own account or config. */
const PROVIDER_KEYS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "CLAUDE_CONFIG_DIR",
  "OPENAI_API_KEY",
  "CODEX_HOME",
];

if (!REAL_SUITES.some((key) => process.env[key] === "true")) {
  // NODE_ENV stays: vitest sets it.
  for (const key of [...HUB_ENV_KEYS, ...PROVIDER_KEYS])
    if (key !== "NODE_ENV") delete process.env[key];
  const home = mkdtempSync(path.join(tmpdir(), "hub-test-home-"));
  process.env.HOME = home;
  afterAll(() => rmSync(home, { recursive: true, force: true }));
}
