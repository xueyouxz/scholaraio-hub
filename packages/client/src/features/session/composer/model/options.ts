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
 * Every field is a real id, never a placeholder.
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
  return { model, permissionMode };
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
 * Options a different provider can run: its own model and permission choices
 * (the remembered ones when it still offers them), and no effort, which
 * belongs to the model that is now gone.
 */
export function optionsForProvider(
  capabilities: ProviderCapabilities,
  models: ModelInfo[],
  current: SessionOptions,
  remembered: ComposerPreference = {},
): SessionOptions {
  const thinking = capabilities.thinkingModes.some((mode) => mode.id === current.thinking)
    ? current.thinking
    : capabilities.thinkingModes[0]?.id;
  // The current choices come first: permission modes are the hub's, so they
  // carry over; a model id belongs to the old provider and rarely matches.
  const preferred = {
    ...remembered,
    ...(current.model ? { model: current.model } : {}),
    ...(current.permissionMode ? { permissionMode: current.permissionMode } : {}),
  };
  return { ...initialOptions(capabilities, models, preferred), thinking, effort: undefined };
}

/** Whether the effort layer applies: providers with a thinking switch hide it while off. */
export function effortApplies(
  capabilities: Pick<ProviderCapabilities, "thinkingModes">,
  thinking?: string,
): boolean {
  return !(capabilities.thinkingModes.length > 0 && thinking === "off");
}
