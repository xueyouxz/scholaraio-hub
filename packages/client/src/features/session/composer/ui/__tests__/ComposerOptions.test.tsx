import type { ProviderCapabilities, ProviderInfo } from "@scholaraio-hub/shared";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionOptions } from "../../../../../core/library";
import {
  type ComposerControls,
  ComposerLeadingOptions,
  ComposerTrailingOptions,
} from "../ComposerOptions";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
});

const claudeCapabilities: ProviderCapabilities = {
  permissionModes: [
    { id: "default", label: "Default" },
    { id: "plan", label: "Plan Mode" },
  ],
  thinkingModes: [
    { id: "adaptive", label: "Thinking on" },
    { id: "off", label: "Thinking off" },
  ],
  slashCommands: "leading",
  contextUsage: "used",
  attachments: { maxBytes: 1, maxCount: 1 },
};

const codexCapabilities: ProviderCapabilities = {
  permissionModes: [
    { id: "plan", label: "Read Only", description: "Read files only" },
    { id: "default", label: "Default" },
    { id: "bypassPermissions", label: "Full Access" },
  ],
  thinkingModes: [],
  slashCommands: "anywhere",
  contextUsage: "remaining",
  attachments: { maxBytes: 1, maxCount: 1 },
};

const info = (
  name: "claude" | "codex",
  capabilities: ProviderCapabilities,
  models: ProviderInfo["models"] = [],
): ProviderInfo => ({
  name,
  displayName: name === "claude" ? "Claude" : "Codex",
  installed: true,
  authenticated: true,
  enabled: true,
  models,
  capabilities,
});

function render(controls: ComposerControls) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      <>
        <ComposerLeadingOptions controls={controls} />
        <ComposerTrailingOptions controls={controls} />
      </>,
    ),
  );
}

const pill = (label: string) =>
  Array.from(container?.querySelectorAll<HTMLButtonElement>("button[aria-haspopup]") ?? []).find(
    (node) => node.textContent === label,
  );
const menuItems = () =>
  Array.from(container?.querySelectorAll('[role="menuitemradio"]') ?? []).map((node) => ({
    label: node.querySelector("span span")?.textContent,
    checked: node.getAttribute("aria-checked") === "true",
  }));
const groups = () =>
  Array.from(container?.querySelectorAll('[role="menu"] fieldset') ?? []).map((node) =>
    node.getAttribute("aria-label"),
  );
function choose(label: string) {
  const item = Array.from(
    container?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [],
  ).find((node) => node.querySelector("span span")?.textContent === label);
  act(() => item?.click());
}

describe("permission menu", () => {
  it("lists the provider's own presets and reports the chosen hub mode", () => {
    const onChange = vi.fn();
    render({ provider: "codex", info: info("codex", codexCapabilities), options: {}, onChange });
    act(() => pill("Default")?.click());
    expect(menuItems()).toEqual([
      { label: "Read Only", checked: false },
      { label: "Default", checked: true },
      { label: "Full Access", checked: false },
    ]);
    choose("Read Only");
    expect(onChange).toHaveBeenCalledWith({ permissionMode: "plan" });
  });

  it("shows nothing before the provider has described itself", () => {
    render({ provider: "claude", options: {}, onChange: () => {} });
    expect(container?.querySelectorAll("button")).toHaveLength(0);
  });
});

describe("effort menu", () => {
  const models = [
    {
      id: "opus",
      name: "Opus",
      isDefault: true,
      efforts: [{ id: "low" }, { id: "max" }],
    },
  ];

  it("layers Claude's thinking switch over the model's effort levels", () => {
    const onChange = vi.fn();
    render({
      provider: "claude",
      info: info("claude", claudeCapabilities, models),
      options: { thinking: "adaptive", effort: "max" },
      onChange,
    });
    act(() => pill("Thinking on · max")?.click());
    expect(groups()).toEqual(["思考", "推理强度"]);
    choose("low");
    expect(onChange).toHaveBeenCalledWith({ effort: "low" });
  });

  it("drops the effort layer while Claude's thinking is off", () => {
    render({
      provider: "claude",
      info: info("claude", claudeCapabilities, models),
      options: { thinking: "off" },
      onChange: () => {},
    });
    act(() => pill("Thinking off")?.click());
    expect(groups()).toEqual(["思考"]);
  });

  it("offers Codex only its reasoning efforts, starting at the model default", () => {
    render({
      provider: "codex",
      info: info("codex", codexCapabilities, [
        {
          id: "gpt",
          name: "gpt",
          isDefault: true,
          efforts: [{ id: "none" }, { id: "xhigh", description: "Deepest" }],
          defaultEffort: "none",
        },
      ]),
      options: {},
      onChange: () => {},
    });
    act(() => pill("none")?.click());
    expect(groups()).toEqual(["推理强度"]);
    expect(menuItems().map((item) => item.label)).toEqual(["默认 (none)", "none", "xhigh"]);
  });
});

describe("model menu", () => {
  it("names the provider default and resets an effort the next model lacks", () => {
    const onChange = vi.fn();
    const options: SessionOptions = { effort: "max" };
    render({
      provider: "claude",
      info: info("claude", claudeCapabilities, [
        { id: "opus", name: "Opus", isDefault: true, efforts: [{ id: "max" }] },
        { id: "haiku", name: "Haiku" },
      ]),
      options,
      onChange,
    });
    act(() => pill("Opus")?.click());
    expect(menuItems().map((item) => item.label)).toEqual(["Opus (默认)", "Opus", "Haiku"]);
    choose("Haiku");
    expect(onChange).toHaveBeenCalledWith({ model: "haiku", effort: "" });
  });

  it("marks options that apply on the next turn", () => {
    render({
      provider: "claude",
      info: info("claude", claudeCapabilities),
      options: {},
      onChange: () => {},
      pending: true,
    });
    expect(container?.textContent).toContain("下一轮生效");
  });
});

describe("provider menu", () => {
  it("switches between installed providers and marks unavailable ones", () => {
    const onProviderChange = vi.fn();
    render({
      provider: "claude",
      info: info("claude", claudeCapabilities),
      options: {},
      onChange: () => {},
      providers: [
        info("claude", claudeCapabilities),
        { ...info("codex", codexCapabilities), authenticated: false },
      ],
      onProviderChange,
    });
    act(() => pill("Claude")?.click());
    const codex = Array.from(
      container?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [],
    ).find((node) => node.textContent?.startsWith("Codex"));
    expect(codex?.disabled).toBe(true);
    expect(codex?.textContent).toContain("未登录");
  });
});
