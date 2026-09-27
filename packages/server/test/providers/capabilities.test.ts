import { ALL_PERMISSION_MODES } from "@scholaraio-hub/shared";
import { describe, expect, it } from "vitest";
import { ClaudeProvider } from "../../src/providers/claude/ClaudeProvider.js";

const claudeProvider = new ClaudeProvider();
import { CodexProvider } from "../../src/providers/codex/CodexProvider.js";
import { codexThreadPolicy } from "../../src/providers/codex/CodexSession.js";

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
      sandbox: codexThreadPolicy(mode.id).sandbox,
    }));
    expect(presets).toEqual([
      { label: "Read Only", sandbox: "read-only" },
      { label: "Default", sandbox: "workspace-write" },
      { label: "Full Access", sandbox: "danger-full-access" },
    ]);
    expect(codex.capabilities.permissionModes.map((mode) => mode.label)).not.toContain("Plan");
    expect(codex.capabilities.thinkingModes).toEqual([]);
    expect(codex.capabilities.slashCommands).toBe("anywhere");
    expect(codex.capabilities.contextUsage).toBe("remaining");
  });
});
