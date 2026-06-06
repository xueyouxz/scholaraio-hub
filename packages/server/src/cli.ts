#!/usr/bin/env node

/**
 * CLI entry point for scholaraio-hub
 *
 * Usage:
 *   scholaraio-hub                    # Start server with defaults
 *   scholaraio-hub --help            # Show help
 *   scholaraio-hub --version         # Show version
 *
 * Environment variables:
 *   PORT                          # Server port (default: 3400)
 *   SCHOLARAIO_HUB_DATA_DIR         # Data directory override
 *   SCHOLARAIO_HUB_PROFILE          # Profile name (creates ~/.scholaraio-hub-{profile}/)
 *   LOG_LEVEL                     # Log level: fatal, error, warn, info, debug, trace
 *   ... (see CLAUDE.md for full list)
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { whichCommand } from "./sdk/cli-detection.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MINIMUM_NODE_VERSION = 20;

/**
 * Check if Node.js version meets minimum requirements.
 * Exits with error if version is too low.
 */
function checkNodeVersion(): void {
  const currentVersion = process.versions.node;
  const majorVersion = Number.parseInt(currentVersion.split(".")[0] ?? "0", 10);

  if (majorVersion < MINIMUM_NODE_VERSION) {
    console.error(`Error: Node.js ${MINIMUM_NODE_VERSION}+ is required.`);
    console.error(`Current version: ${currentVersion}`);
    console.error("");
    console.error("Please upgrade Node.js: https://nodejs.org/");
    process.exit(1);
  }
}

/**
 * Check if Claude CLI is installed and warn if not found.
 * Does not exit - Claude is optional but recommended.
 */
function checkClaudeCli(): void {
  try {
    execSync(whichCommand("claude"), {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    console.warn("Warning: Claude CLI not found.");
    console.warn("Claude Code is the primary supported agent. Install it to use Claude sessions:");
    console.warn(
      os.platform() === "win32"
        ? "  irm https://claude.ai/install.ps1 | iex"
        : "  curl -fsSL https://claude.ai/install.sh | bash",
    );
    console.warn("");
  }
}

function showHelp(): void {
  console.log(`
scholaraio-hub - A mobile-first supervisor for Claude Code agents

USAGE:
  scholaraio-hub [OPTIONS]

OPTIONS:
  --help, -h            Show this help message
  --version, -v         Show version number
  --port <number>       Server port (default: 3400)
  --host <address>      Host/interface to bind to (default: localhost)
                        Use 0.0.0.0 to bind all interfaces
  --https-self-signed   Enable HTTPS using a self-signed certificate
                        stored in the app data directory
  --open                Open the dashboard in your default browser on startup

SECURITY:
  This server has no authentication. Access is restricted by a host allowlist
  (localhost, private LAN, *.ts.net) that guards against DNS rebinding. Do not
  expose it directly to untrusted networks.

ENVIRONMENT VARIABLES:
  PORT                          Server port (default: 3400)
  HOST                          Host/interface to bind (default: localhost)
  SCHOLARAIO_HUB_DATA_DIR         Data directory override
  SCHOLARAIO_HUB_PROFILE          Profile name (creates ~/.scholaraio-hub-{profile}/)
  HTTPS_SELF_SIGNED             Enable HTTPS with a self-signed certificate
  LOG_LEVEL                     Log level: fatal, error, warn, info, debug, trace
  LOG_PRETTY                    Pretty-print console logs (default: true)
  MAINTENANCE_PORT              Maintenance server port (default: disabled)
  CODEX_WATCH_PERIODIC_RESCAN_MS
                                Codex watcher fallback rescan interval in ms (default: 5000 on macOS, 0 elsewhere)
  SESSION_INDEX_FULL_VALIDATION_MS
                                Session index full validation interval in ms (default: 30000, 0 = validate every request)
  SESSION_INDEX_WRITE_LOCK_TIMEOUT_MS
                                Session index write lock timeout in ms (default: 2000)
  SESSION_INDEX_WRITE_LOCK_STALE_MS
                                Session index stale lock threshold in ms (default: 10000)
  PROJECT_SCAN_CACHE_TTL_MS
                                Project scan cache TTL in ms (default: 5000, 0 = rescan every request)

EXAMPLES:
  # Start with defaults (port 3400, localhost only)
  scholaraio-hub

  # Start on custom port
  scholaraio-hub --port 8000

  # Bind to all interfaces (accessible from network)
  scholaraio-hub --host 0.0.0.0

  # HTTPS on localhost/LAN with auto-generated self-signed cert
  scholaraio-hub --host 0.0.0.0 --https-self-signed

  # Custom port and host
  scholaraio-hub --port 8000 --host 0.0.0.0

  # Use development profile (separate data directory)
  SCHOLARAIO_HUB_PROFILE=dev scholaraio-hub

DOCUMENTATION:
  For full documentation, see: https://github.com/kzahel/scholaraio-hub

DATA DIRECTORY:
  Development default: ~/.scholaraio-hub-dev/
  Production default:  ~/.scholaraio-hub/
  Contains: logs/, indexes/, uploads/, session metadata, push subscriptions

REQUIREMENTS:
  - Node.js >= 20
  - Claude CLI installed (curl -fsSL https://claude.ai/install.sh | bash)
`);
}

function getVersion(): string {
  try {
    // Read package.json from the package root
    const packageJsonPath = path.resolve(__dirname, "../package.json");
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
    return packageJson.version || "unknown";
  } catch (error) {
    return "unknown";
  }
}

function showVersion(): void {
  console.log(`scholaraio-hub v${getVersion()}`);
}

// Parse command line arguments
const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  showHelp();
  process.exit(0);
}

if (args.includes("--version") || args.includes("-v")) {
  showVersion();
  process.exit(0);
}

// Parse --port option
const portIndex = args.indexOf("--port");
if (portIndex !== -1) {
  const portValue = args[portIndex + 1];
  if (!portValue || portValue.startsWith("-")) {
    console.error("Error: --port requires a value (e.g., --port 8000)");
    process.exit(1);
  }
  const portNum = Number.parseInt(portValue, 10);
  if (Number.isNaN(portNum) || portNum < 1 || portNum > 65535) {
    console.error("Error: --port must be a valid port number (1-65535)");
    process.exit(1);
  }
  process.env.PORT = portValue;
  // Mark that port was explicitly set via CLI (prevents runtime changes)
  process.env.CLI_PORT_OVERRIDE = "true";
  // Remove --port and its value from args
  args.splice(portIndex, 2);
}

// Parse --host option
const hostIndex = args.indexOf("--host");
if (hostIndex !== -1) {
  const hostValue = args[hostIndex + 1];
  if (!hostValue || hostValue.startsWith("-")) {
    console.error("Error: --host requires a value (e.g., --host 0.0.0.0)");
    process.exit(1);
  }
  process.env.HOST = hostValue;
  // Mark that host was explicitly set via CLI (prevents runtime changes)
  process.env.CLI_HOST_OVERRIDE = "true";
  // Remove --host and its value from args
  args.splice(hostIndex, 2);
}

// Parse --open flag
const openIndex = args.indexOf("--open");
if (openIndex !== -1) {
  process.env.OPEN_BROWSER = "true";
  args.splice(openIndex, 1);
}

// Parse --https-self-signed flag
const httpsSelfSignedIndex = args.indexOf("--https-self-signed");
if (httpsSelfSignedIndex !== -1) {
  process.env.HTTPS_SELF_SIGNED = "true";
  args.splice(httpsSelfSignedIndex, 1);
}

// If there are unknown arguments, show error and help
if (args.length > 0) {
  console.error(`Error: Unknown arguments: ${args.join(" ")}`);
  console.error("");
  console.error("Run 'scholaraio-hub --help' for usage information.");
  process.exit(1);
}

// Run prerequisite checks
checkNodeVersion();

// Set NODE_ENV to production if not already set (CLI users expect production mode)
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = "production";
}

// Only check for Claude CLI when starting the server
checkClaudeCli();
runServer();

/**
 * Start the server by importing the main module.
 * This ensures all initialization happens in index.ts as designed.
 */
function runServer(): void {
  import("./index.js").catch((error) => {
    console.error("Failed to start server:", error);
    process.exit(1);
  });
}
