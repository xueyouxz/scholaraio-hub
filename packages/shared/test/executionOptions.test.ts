import { describe, expect, it } from "vitest";
import { readLegacyThinking, thinkingModeToConfig } from "../src/types.js";

describe("readLegacyThinking", () => {
  it("splits the old combined value into thinking mode and native effort", () => {
    expect(readLegacyThinking("off")).toEqual({ thinking: "off" });
    expect(readLegacyThinking("auto")).toEqual({ thinking: "adaptive" });
    expect(readLegacyThinking("on:max")).toEqual({ thinking: "adaptive", effort: "max" });
    expect(readLegacyThinking("medium")).toEqual({ thinking: "adaptive", effort: "medium" });
    expect(readLegacyThinking("adaptive")).toEqual({ thinking: "adaptive" });
  });
});

describe("thinkingModeToConfig", () => {
  it("maps the mode to the SDK thinking config", () => {
    expect(thinkingModeToConfig("off")).toEqual({ type: "disabled" });
    expect(thinkingModeToConfig("adaptive")).toEqual({ type: "adaptive" });
  });
});
