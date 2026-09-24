import { loadRuntimeEnv } from "./env.js";
import { resolveProfile } from "./runtime/profile.js";

export function getDataDir(): string {
  // Loading fills process.env from the env files; the profile reads the raw values.
  loadRuntimeEnv();
  return resolveProfile(process.env).dataDir;
}
