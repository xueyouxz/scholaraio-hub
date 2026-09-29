import type { ModelInfo, ProviderCapabilities } from "@scholaraio-hub/shared";
import type { SessionOptions } from "../../../../core/sessions";
import type { ComposerPreference } from "./preferences";

/** The model a session runs: the one it names, else the provider's default. */
export function resolveModel(models: ModelInfo[], modelId?: string): ModelInfo | undefined {
  return (
    (modelId ? models.find((model) => model.id === modelId) : undefined) ??
    (modelId ? undefined : (models.find((model) => model.isDefault) ?? models[0]))
  );
}

/**
 * The options a new chat starts with for `provider`: the choices it made last
 * time when the provider still offers them, else the provider's own defaults.
 * Model and permission mode are always real ids, never placeholders; thinking
 * and effort are set only when a remembered one still applies, and otherwise
 * left to the provider.
 */
export function initialOptions(
  capabilities: ProviderCapabilities,
  models: ModelInfo[],
  remembered: ComposerPreference = {},
): SessionOptions {
  const model = models.some((candidate) => candidate.id === remembered.model)
    ? remembered.model
    : resolveModel(models)?.id;
  const permissionMode = capabilities.permissionModes.some(
    (mode) => mode.id === remembered.permissionMode,
  )
    ? remembered.permissionMode
    : (capabilities.permissionModes.find((mode) => mode.id === "default")?.id ??
      capabilities.permissionModes[0]?.id);
  const options: SessionOptions = { model, permissionMode };
  if (capabilities.thinkingModes.some((mode) => mode.id === remembered.thinking))
    options.thinking = remembered.thinking;
  // An effort belongs to a model: it carries over only to one that offers it.
  if (resolveModel(models, model)?.efforts?.some((option) => option.id === remembered.effort))
    options.effort = remembered.effort;
  return options;
}

/**
 * The option patch for switching to `nextModelId` ("" = provider default): the
 * effort stays when the next model offers it, else returns to that model's default.
 */
export function modelChange(
  models: ModelInfo[],
  current: SessionOptions,
  nextModelId: string,
): SessionOptions {
  const next = resolveModel(models, nextModelId || undefined);
  const keepsEffort =
    !current.effort || !next || next.efforts?.some((option) => option.id === current.effort);
  return { model: nextModelId, ...(keepsEffort ? {} : { effort: "" }) };
}

/**
 * Options a different provider can run: each current choice it also offers,
 * else the one remembered for it, else its own default. The current effort
 * stays behind with the old model; a remembered one applies when it fits.
 */
export function optionsForProvider(
  capabilities: ProviderCapabilities,
  models: ModelInfo[],
  current: SessionOptions,
  remembered: ComposerPreference = {},
): SessionOptions {
  const offersThinking = (id?: string) => capabilities.thinkingModes.some((mode) => mode.id === id);
  const thinking = [current.thinking, remembered.thinking].find(offersThinking);
  // Permission modes are the hub's, so they usually carry over; a model id
  // belongs to the old provider and rarely matches, so the remembered one wins then.
  const preferred: ComposerPreference = {
    ...remembered,
    ...(models.some((model) => model.id === current.model) ? { model: current.model } : {}),
    ...(capabilities.permissionModes.some((mode) => mode.id === current.permissionMode)
      ? { permissionMode: current.permissionMode }
      : {}),
  };
  const options = initialOptions(capabilities, models, preferred);
  return {
    ...options,
    thinking: thinking ?? capabilities.thinkingModes[0]?.id,
    effort: options.effort,
  };
}

/** Whether the effort layer applies: providers with a thinking switch hide it while off. */
export function effortApplies(
  capabilities: Pick<ProviderCapabilities, "thinkingModes">,
  thinking?: string,
): boolean {
  return !(capabilities.thinkingModes.length > 0 && thinking === "off");
}
