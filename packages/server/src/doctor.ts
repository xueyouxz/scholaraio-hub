/**
 * The AI CLIs this server runs, checked the way the app checks them:
 * `pnpm hub doctor` runs this after its own checks. Exits 0 when at least one
 * provider can run with a local login.
 */
import { spawnSync } from "node:child_process";
import {
  claudeProvider,
  resolveLocalClaudeCodeExecutable,
} from "./providers/claude/ClaudeProvider.js";
import { codexProvider } from "./providers/codex/CodexProvider.js";
import { findCodexCli } from "./providers/codex/cli.js";

const codex = await findCodexCli();
console.log(
  `Codex: ${codex ? `${codex.path} (${codex.version})` : "Codex CLI cannot run. Repair with: npm install -g @openai/codex"}`,
);
const claudePath = resolveLocalClaudeCodeExecutable();
const claude = claudePath
  ? spawnSync(claudePath, ["--version"], { encoding: "utf8", timeout: 10000 })
  : undefined;
console.log(`Claude: ${claude?.status === 0 ? claude.stdout.trim() : "not executable"}`);
// The providers decide what counts as logged in; this asks them the same way the app does.
const [claudeAuth, codexAuth] = await Promise.all([
  claudeProvider.getAuthStatus(),
  codexProvider.getAuthStatus(),
]);
console.log(
  `Claude local login: ${claudeAuth.authenticated ? "present" : "unavailable; run claude auth login"}`,
);
console.log(
  `Codex local login: ${codexAuth.authenticated ? "present" : "unavailable; run codex login"}`,
);
console.log("Local login does not prove that a remote token has not expired or been revoked.");
process.exitCode = claudeAuth.authenticated || codexAuth.authenticated ? 0 : 1;
