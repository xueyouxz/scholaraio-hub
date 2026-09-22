import { ALL_PERMISSION_MODES } from "@scholaraio-hub/shared";
import { describe, expect, it } from "vitest";
import { claudeProvider } from "../../../src/sdk/providers/claude.js";
import { CodexProvider } from "../../../src/sdk/providers/codex.js";
import { providerPosture } from "../../../src/sdk/providers/permission-policy.js";

describe("provider capabilities", () => {
  it("offers every hub permission mode under Claude's own titles", () => {
    const { permissionModes } = claudeProvider.capabilities;
    expect(permissionModes.map((mode) => mode.id).sort()).toEqual([...ALL_PERMISSION_MODES].sort());
    expect(claudeProvider.capabilities.slashCommands).toBe("leading");
  });

  it("offers one Codex preset per sandbox boundary, without a plan mode", () => {
    const codex = new CodexProvider();
    const presets = codex.capabilities.permissionModes.map((mode) => ({
      label: mode.label,
      sandbox: providerPosture(mode.id).sandbox,
    }));
    expect(presets).toEqual([
      { label: "Read Only", sandbox: "read-only" },
      { label: "Default", sandbox: "workspace-write" },
      { label: "Full Access", sandbox: "full-access" },
    ]);
    expect(codex.capabilities.permissionModes.map((mode) => mode.label)).not.toContain("Plan");
    expect(codex.capabilities.thinkingModes).toEqual([]);
    expect(codex.capabilities.slashCommands).toBe("anywhere");
    expect(codex.capabilities.contextUsage).toBe("remaining");
  });
});
