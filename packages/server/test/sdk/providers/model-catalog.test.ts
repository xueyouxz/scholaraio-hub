import { describe, expect, it } from "vitest";
import { toModelInfo } from "../../../src/sdk/providers/claude.js";
import { toCodexModels } from "../../../src/sdk/providers/codex.js";

describe("Claude model catalog", () => {
  it("keeps the CLI's naming and only lists efforts the model supports", () => {
    expect(
      toModelInfo({
        value: "opus",
        displayName: "Opus",
        description: "Most capable",
        supportsEffort: true,
        supportedEffortLevels: ["low", "medium", "high", "max"],
        supportsAdaptiveThinking: true,
      }),
    ).toEqual({
      id: "opus",
      name: "Opus",
      description: "Most capable",
      efforts: [{ id: "low" }, { id: "medium" }, { id: "high" }, { id: "max" }],
      supportsAdaptiveThinking: true,
    });
    expect(
      toModelInfo({
        value: "haiku",
        displayName: "Haiku",
        description: "Fast",
        supportsEffort: false,
        supportedEffortLevels: ["low"],
      }),
    ).toEqual({ id: "haiku", name: "Haiku", description: "Fast" });
  });
});

describe("Codex model catalog", () => {
  it("lists visible models in app-server order with their reasoning efforts", () => {
    expect(
      toCodexModels([
        {
          id: "a",
          model: "gpt-x",
          displayName: "gpt-x",
          description: "Frontier",
          isDefault: true,
          supportedReasoningEfforts: [
            { reasoningEffort: "low", description: "Fast" },
            { reasoningEffort: "xhigh", description: "Deepest" },
          ],
          defaultReasoningEffort: "low",
        },
        { id: "hidden", model: "gpt-old", hidden: true },
        { id: "gpt-mini" },
        { id: "gpt-x-dup", model: "gpt-x" },
      ]),
    ).toEqual([
      {
        id: "gpt-x",
        name: "gpt-x",
        description: "Frontier",
        isDefault: true,
        efforts: [
          { id: "low", description: "Fast" },
          { id: "xhigh", description: "Deepest" },
        ],
        defaultEffort: "low",
      },
      { id: "gpt-mini", name: "gpt-mini" },
    ]);
  });
});
