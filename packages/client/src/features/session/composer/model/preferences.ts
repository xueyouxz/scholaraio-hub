import type { PermissionMode, ProviderName } from "@scholaraio-hub/shared";
import { readStoredJson, writeStoredJson } from "../../../../core/browserStorage";
import type { SessionOptions } from "../../../../core/sessions";

/** What the composer remembers per agent, so a new chat opens where the last one left off. */
export interface ComposerPreference {
  model?: string;
  permissionMode?: PermissionMode;
}

const key = (provider: ProviderName) => `hub-composer:choice:${provider}`;

export function readComposerPreference(provider: ProviderName): ComposerPreference {
  return readStoredJson<ComposerPreference>(key(provider), {});
}

/** Remember the model and permission mode the user just picked for this agent. */
export function rememberComposerChoice(provider: ProviderName, patch: SessionOptions): void {
  const remembered: ComposerPreference = {};
  if (patch.model !== undefined) remembered.model = patch.model;
  if (patch.permissionMode !== undefined) remembered.permissionMode = patch.permissionMode;
  if (Object.keys(remembered).length === 0) return;
  writeStoredJson(key(provider), { ...readComposerPreference(provider), ...remembered });
}
