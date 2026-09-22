import type { ModelInfo, ProviderCapabilities } from "@scholaraio-hub/shared";
import { describe, expect, it } from "vitest";
import { effortApplies, modelChange, optionsForProvider, resolveModel } from "../options";

const models: ModelInfo[] = [
  { id: "fast", name: "Fast", isDefault: true, efforts: [{ id: "low" }] },
  { id: "deep", name: "Deep", efforts: [{ id: "low" }, { id: "xhigh" }] },
  { id: "plain", name: "Plain" },
];

const capabilities = (overrides: Partial<ProviderCapabilities> = {}): ProviderCapabilities => ({
  permissionModes: [
    { id: "plan", label: "Read Only" },
    { id: "default", label: "Default" },
  ],
  thinkingModes: [],
  slashCommands: "anywhere",
  contextUsage: "remaining",
  attachments: { maxBytes: 1, maxCount: 1 },
  ...overrides,
});

describe("resolveModel", () => {
  it("uses the named model, else the provider default", () => {
    expect(resolveModel(models, "deep")?.name).toBe("Deep");
    expect(resolveModel(models)?.name).toBe("Fast");
    expect(resolveModel(models, "gone")).toBeUndefined();
  });
});

describe("modelChange", () => {
  it("keeps an effort the next model offers", () => {
    expect(modelChange(models, { effort: "low" }, "deep")).toEqual({ model: "deep" });
  });

  it("returns to the next model's default effort otherwise", () => {
    expect(modelChange(models, { effort: "xhigh" }, "")).toEqual({ model: "", effort: "" });
    expect(modelChange(models, { effort: "low" }, "plain")).toEqual({ model: "plain", effort: "" });
  });
});

describe("optionsForProvider", () => {
  it("keeps offered choices and resets the model and effort", () => {
    expect(
      optionsForProvider(capabilities(), {
        permissionMode: "plan",
        thinking: "adaptive",
        model: "opus",
        effort: "max",
      }),
    ).toEqual({ permissionMode: "plan", thinking: undefined, model: undefined, effort: undefined });
  });

  it("falls back to the provider's default permission and first thinking choice", () => {
    expect(
      optionsForProvider(capabilities({ thinkingModes: [{ id: "adaptive", label: "On" }] }), {
        permissionMode: "acceptEdits",
        thinking: "off",
      }),
    ).toMatchObject({ permissionMode: "default", thinking: "adaptive" });
  });
});

describe("effortApplies", () => {
  it("hides effort only while a provider's thinking switch is off", () => {
    expect(effortApplies(capabilities(), "off")).toBe(true);
    expect(
      effortApplies(capabilities({ thinkingModes: [{ id: "off", label: "Off" }] }), "off"),
    ).toBe(false);
  });
});
