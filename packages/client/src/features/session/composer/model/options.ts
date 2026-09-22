import type { ModelInfo, ProviderCapabilities } from "@scholaraio-hub/shared";
import type { SessionOptions } from "../../../../core/library";

/** The model a session runs: the one it names, else the provider's default. */
export function resolveModel(models: ModelInfo[], modelId?: string): ModelInfo | undefined {
  return modelId ? models.find((model) => model.id === modelId) : models.find((m) => m.isDefault);
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
 * Options that a different provider can run: choices it does not offer fall
 * back to its first offer, and the model and effort return to its defaults.
 */
export function optionsForProvider(
  capabilities: ProviderCapabilities,
  current: SessionOptions,
): SessionOptions {
  const permission = capabilities.permissionModes.some((mode) => mode.id === current.permissionMode)
    ? current.permissionMode
    : (capabilities.permissionModes.find((mode) => mode.id === "default")?.id ??
      capabilities.permissionModes[0]?.id);
  const thinking = capabilities.thinkingModes.some((mode) => mode.id === current.thinking)
    ? current.thinking
    : capabilities.thinkingModes[0]?.id;
  return { permissionMode: permission, thinking, model: undefined, effort: undefined };
}

/** Whether the effort layer applies: providers with a thinking switch hide it while off. */
export function effortApplies(
  capabilities: Pick<ProviderCapabilities, "thinkingModes">,
  thinking?: string,
): boolean {
  return !(capabilities.thinkingModes.length > 0 && thinking === "off");
}
