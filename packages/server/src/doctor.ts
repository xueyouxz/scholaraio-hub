/**
 * The AI CLIs this server runs, checked the way the app checks them:
 * `pnpm hub doctor` runs this after its own checks. Exits 0 when at least one
 * provider can run with a local login.
 */
import { spawnSync } from "node:child_process";
import { loadClaudeSettings } from "./config.js";
import { ClaudeProvider } from "./providers/claude/ClaudeProvider.js";
import { resolveLocalClaudeCodeExecutable } from "./providers/claude/cli.js";
import { CodexProvider } from "./providers/codex/CodexProvider.js";
import { findCodexCli } from "./providers/codex/cli.js";

// doctor 不经启动器运行：只读 Claude 相关变量，不需要实例配置。
const claudeSettings = loadClaudeSettings();
const claudeProvider = new ClaudeProvider(claudeSettings);
const codexProvider = new CodexProvider();

const codex = await findCodexCli();
console.log(
  `Codex: ${codex ? `${codex.path} (${codex.version})` : "Codex CLI cannot run. Repair with: npm install -g @openai/codex"}`,
);
const claudePath = resolveLocalClaudeCodeExecutable(claudeSettings.executable);
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
