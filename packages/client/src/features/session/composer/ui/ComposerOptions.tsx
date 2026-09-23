import type { ProviderInfo, ProviderName, SessionContextUsage } from "@scholaraio-hub/shared";
import { Brain, ShieldCheck } from "lucide-react";
import type { SessionOptions } from "../../../../core/library";
import { effortApplies, modelChange, resolveModel } from "../model/options";
import { ContextMeter } from "./controls/ContextMeter";
import { MenuButton, type MenuSection } from "./controls/Menu";
import { ProviderLogo } from "./controls/ProviderLogo";

/**
 * Everything the composer's option pills need. Choices come from the
 * provider's own description (`info`); nothing here names a model or a mode.
 */
export interface ComposerControls {
  provider: ProviderName;
  /** The provider as `/api/providers` describes it; undefined while loading. */
  info?: ProviderInfo;
  options: SessionOptions;
  onChange: (patch: SessionOptions) => void | Promise<void>;
  disabled?: boolean;
  /** Some options were changed mid-turn and apply when the next turn starts. */
  pending?: boolean;
  error?: string;
  /** Context window fill after the last turn, as the provider counted it. */
  contextUsage?: SessionContextUsage;
  /** Providers to switch between; only a new session offers this. */
  providers?: ProviderInfo[];
  onProviderChange?: (provider: ProviderName) => void;
}

const DEFAULT_LABEL = "Default";

/** A request, e.g. from a /command, to open one of the option menus. */
export interface MenuRequest {
  menu: "model" | "effort" | "permissions";
  seq: number;
}

const requested = (request: MenuRequest | undefined, menu: MenuRequest["menu"]) =>
  request?.menu === menu ? request.seq : undefined;

/** Which option menus the provider gives this composer something to choose in. */
export function availableMenus(controls: ComposerControls): Set<MenuRequest["menu"]> {
  const menus = new Set<MenuRequest["menu"]>();
  const capabilities = controls.info?.capabilities;
  if (!capabilities) return menus;
  if (capabilities.permissionModes.length > 0) menus.add("permissions");
  const model = resolveModel(controls.info?.models ?? [], controls.options.model || undefined);
  if (capabilities.thinkingModes.length > 0 || model?.efforts?.length) menus.add("effort");
  if (controls.info?.models?.length || controls.options.model) menus.add("model");
  return menus;
}

export function ProviderMenu({ controls }: { controls: ComposerControls }) {
  const { providers, onProviderChange } = controls;
  if (!providers?.length || !onProviderChange) return null;
  const current = providers.find((item) => item.name === controls.provider);
  return (
    <MenuButton
      icon={<ProviderLogo provider={controls.provider} size={13} />}
      label={current?.displayName ?? controls.provider}
      title="Agent"
      disabled={controls.disabled}
      sections={[
        {
          selected: controls.provider,
          onSelect: (id) => onProviderChange(id as ProviderName),
          items: providers.map((item) => ({
            id: item.name,
            label: item.displayName,
            icon: <ProviderLogo provider={item.name} size={15} />,
            disabled: !item.installed || !item.authenticated,
            description: !item.installed
              ? "Not installed"
              : !item.authenticated
                ? "Not signed in"
                : undefined,
          })),
        },
      ]}
    />
  );
}

export function PermissionMenu({
  controls,
  request,
}: { controls: ComposerControls; request?: MenuRequest }) {
  const modes = controls.info?.capabilities.permissionModes ?? [];
  if (modes.length === 0) return null;
  // Without an explicit choice the provider's first mode is what runs.
  const selected = controls.options.permissionMode ?? modes[0]?.id ?? "default";
  const current = modes.find((mode) => mode.id === selected);
  return (
    <MenuButton
      icon={<ShieldCheck size={12} aria-hidden="true" />}
      label={current?.label ?? selected}
      title={current?.description}
      disabled={controls.disabled}
      openRequest={requested(request, "permissions")}
      sections={[
        {
          selected,
          onSelect: (id) =>
            void controls.onChange({ permissionMode: id as NonNullable<typeof selected> }),
          items: modes.map((mode) => ({
            id: mode.id,
            label: mode.label,
            description: mode.description,
          })),
        },
      ]}
    />
  );
}

/**
 * Thinking and effort as the provider layers them: a thinking switch (when the
 * provider has one) over the current model's effort levels.
 */
export function EffortMenu({
  controls,
  request,
}: { controls: ComposerControls; request?: MenuRequest }) {
  const capabilities = controls.info?.capabilities;
  if (!capabilities) return null;
  const model = resolveModel(controls.info?.models ?? [], controls.options.model || undefined);
  const thinkingModes = capabilities.thinkingModes;
  const efforts = model?.efforts ?? [];
  const thinking = controls.options.thinking ?? thinkingModes[0]?.id;
  const showEffort = efforts.length > 0 && effortApplies(capabilities, thinking);
  if (thinkingModes.length === 0 && efforts.length === 0) return null;

  const sections: MenuSection[] = [];
  if (thinkingModes.length > 0) {
    sections.push({
      title: "Thinking",
      selected: thinking,
      onSelect: (id) => void controls.onChange({ thinking: id as typeof thinking }),
      items: thinkingModes.map((mode) => ({ id: mode.id, label: mode.label })),
    });
  }
  if (showEffort) {
    const defaultEffort = model?.defaultEffort;
    sections.push({
      title: "Effort",
      selected: controls.options.effort ?? "",
      onSelect: (id) => void controls.onChange({ effort: id }),
      items: [
        { id: "", label: defaultEffort ? `${DEFAULT_LABEL} (${defaultEffort})` : DEFAULT_LABEL },
        ...efforts.map((effort) => ({
          id: effort.id,
          label: effort.id,
          description: effort.description,
        })),
      ],
    });
  }

  const thinkingLabel = thinkingModes.find((mode) => mode.id === thinking)?.label;
  const effortLabel = showEffort ? (controls.options.effort ?? model?.defaultEffort) : undefined;
  const label = [thinkingLabel, effortLabel].filter(Boolean).join(" · ") || DEFAULT_LABEL;
  return (
    <MenuButton
      icon={<Brain size={12} aria-hidden="true" />}
      label={label}
      title="Thinking and effort"
      disabled={controls.disabled}
      openRequest={requested(request, "effort")}
      sections={sections}
    />
  );
}

export function ModelMenu({
  controls,
  request,
}: { controls: ComposerControls; request?: MenuRequest }) {
  const models = controls.info?.models ?? [];
  const chosen = controls.options.model;
  // Menus name real models only; without a choice the provider's default runs.
  const current = resolveModel(models, chosen);
  const selected = current?.id ?? chosen ?? "";
  if (models.length === 0 && !chosen) return null;
  const items = [
    ...(chosen && !models.some((model) => model.id === chosen)
      ? [{ id: chosen, label: chosen }]
      : []),
    ...models.map((model) => ({ id: model.id, label: model.name, description: model.description })),
  ];
  return (
    <MenuButton
      icon={<ProviderLogo provider={controls.provider} size={13} />}
      label={current?.name ?? selected}
      title="Model"
      align="right"
      disabled={controls.disabled}
      openRequest={requested(request, "model")}
      sections={[
        {
          selected,
          onSelect: (id) => void controls.onChange(modelChange(models, controls.options, id)),
          items,
        },
      ]}
    />
  );
}

/** Option pills left of the voice button. */
export function ComposerLeadingOptions({
  controls,
  request,
}: { controls: ComposerControls; request?: MenuRequest }) {
  return (
    <>
      <ProviderMenu controls={controls} />
      <PermissionMenu controls={controls} request={request} />
      <EffortMenu controls={controls} request={request} />
    </>
  );
}

/** Context meter, model pill and change status left of the send button. */
export function ComposerTrailingOptions({
  controls,
  request,
}: { controls: ComposerControls; request?: MenuRequest }) {
  return (
    <>
      {controls.contextUsage ? <ContextMeter usage={controls.contextUsage} /> : null}
      {controls.pending ? (
        <span className="text-[11px] text-on-surface-variant whitespace-nowrap">
          Applies next turn
        </span>
      ) : null}
      {controls.error ? (
        <span role="alert" className="text-error text-xs">
          {controls.error}
        </span>
      ) : null}
      <ModelMenu controls={controls} request={request} />
    </>
  );
}
