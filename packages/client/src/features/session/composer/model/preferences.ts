import type { PermissionMode, ProviderName } from "@scholaraio-hub/shared";
import type { SessionOptions } from "../../../../core/library";

/** What the composer remembers per agent, so a new chat opens where the last one left off. */
export interface ComposerPreference {
  model?: string;
  permissionMode?: PermissionMode;
}

const key = (provider: ProviderName) => `hub-composer:choice:${provider}`;

export function readComposerPreference(provider: ProviderName): ComposerPreference {
  try {
    const stored = localStorage.getItem(key(provider));
    return stored ? (JSON.parse(stored) as ComposerPreference) : {};
  } catch (error) {
    console.warn("无法读取上次的会话选项", error);
    return {};
  }
}

/** Remember the model and permission mode the user just picked for this agent. */
export function rememberComposerChoice(provider: ProviderName, patch: SessionOptions): void {
  const remembered: ComposerPreference = {};
  if (patch.model !== undefined) remembered.model = patch.model;
  if (patch.permissionMode !== undefined) remembered.permissionMode = patch.permissionMode;
  if (Object.keys(remembered).length === 0) return;
  try {
    localStorage.setItem(
      key(provider),
      JSON.stringify({ ...readComposerPreference(provider), ...remembered }),
    );
  } catch (error) {
    console.warn("无法保存会话选项", error);
  }
}
