import type { ProviderName } from "@scholaraio-hub/shared";
import { readStoredJson, writeStoredJson } from "../../../../core/browserStorage";
import type { SessionOptions } from "../../../../core/sessions";

/**
 * What the composer remembers per agent, so the next chat opens where the last
 * one left off: the same four choices a session runs with (an effort of "" is
 * the model's own default). Kept in this browser only; a choice the agent no
 * longer offers is dropped when it is read back (`initialOptions`).
 */
export type ComposerPreference = SessionOptions;

const key = (provider: ProviderName) => `hub-composer:choice:${provider}`;

export function readComposerPreference(provider: ProviderName): ComposerPreference {
  return readStoredJson<ComposerPreference>(key(provider), {});
}

/** Remember the model, permission mode, thinking and effort the user just picked for this agent. */
export function rememberComposerChoice(provider: ProviderName, patch: SessionOptions): void {
  const remembered: ComposerPreference = {};
  if (patch.model !== undefined) remembered.model = patch.model;
  if (patch.permissionMode !== undefined) remembered.permissionMode = patch.permissionMode;
  if (patch.thinking !== undefined) remembered.thinking = patch.thinking;
  if (patch.effort !== undefined) remembered.effort = patch.effort;
  if (Object.keys(remembered).length === 0) return;
  writeStoredJson(key(provider), { ...readComposerPreference(provider), ...remembered });
}
