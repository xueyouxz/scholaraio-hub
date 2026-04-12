import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";

export interface VersionInfo {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  resumeProtocolVersion: number;
  capabilities: string[];
}

export const RESUME_PROTOCOL_VERSION = 2;
const BASE_CAPABILITIES: string[] = [];

export interface VersionRouteOptions {
  installId?: string;
  voiceInputEnabled?: boolean;
}

export interface ServerCompatibilityInfo {
  appVersion: string;
  resumeProtocolVersion: number;
  renderProtocolVersion?: number;
  capabilities: string[];
}

async function getCurrentVersion(): Promise<string> {
  const packageJsonPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../package.json",
  );

  try {
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf-8")) as {
      version?: string;
    };
    const version = packageJson.version ?? "0.0.1";
    const gitSha = process.env.GIT_COMMIT_SHA?.trim();

    return gitSha ? `${version}+${gitSha.slice(0, 7)}` : version;
  } catch {
    return "0.0.1";
  }
}

export function getServerCapabilities(options?: VersionRouteOptions): string[] {
  const capabilities = [...BASE_CAPABILITIES];
  if (options?.voiceInputEnabled !== false) {
    capabilities.push("voiceInput");
  }
  return capabilities;
}

export function getServerCompatibilityInfo(
  options?: VersionRouteOptions,
): Promise<ServerCompatibilityInfo> {
  return getCurrentVersion().then((appVersion) => ({
    appVersion,
    resumeProtocolVersion: RESUME_PROTOCOL_VERSION,
    capabilities: getServerCapabilities(options),
  }));
}

export function createVersionRoutes(options?: VersionRouteOptions): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const current = await getCurrentVersion();
    const latest = current;
    const updateAvailable = false;

    const body: VersionInfo = {
      current,
      latest,
      updateAvailable,
      resumeProtocolVersion: RESUME_PROTOCOL_VERSION,
      capabilities: getServerCapabilities(options),
    };

    return c.json(body);
  });

  return app;
}
