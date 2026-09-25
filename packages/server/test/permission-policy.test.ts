import type { PermissionMode } from "@scholaraio-hub/shared";
import { describe, expect, it } from "vitest";
import { codexThreadPolicy } from "../src/providers/codex/CodexSession.js";
import { decidePermission } from "../src/supervisor/permission-policy.js";

const MODES: PermissionMode[] = ["default", "acceptEdits", "plan", "bypassPermissions"];

describe("permission contract", () => {
  it("never auto-answers tools that are questions to the user", () => {
    for (const mode of MODES) {
      expect(decidePermission(mode, "AskUserQuestion", {})).toBe("ask");
      expect(decidePermission(mode, "ExitPlanMode", {})).toBe("ask");
    }
  });

  it("auto-approves reads in every mode", () => {
    for (const mode of MODES) {
      expect(decidePermission(mode, "Read", { file_path: "a.ts" })).toBe("allow");
      expect(decidePermission(mode, "Grep", { pattern: "x" })).toBe("allow");
    }
  });

  it("widens monotonically from default to bypass", () => {
    expect(decidePermission("default", "Edit", {})).toBe("ask");
    expect(decidePermission("acceptEdits", "Edit", {})).toBe("allow");
    expect(decidePermission("acceptEdits", "Bash", {})).toBe("ask");
    expect(decidePermission("bypassPermissions", "Bash", {})).toBe("allow");
  });

  it("lets plan mode save its own plan but nothing else", () => {
    expect(decidePermission("plan", "Write", { file_path: ".claude/plans/p.md" })).toBe("allow");
    expect(decidePermission("plan", "Write", { file_path: "src/index.ts" })).toBe("ask");
    expect(decidePermission("plan", "Bash", { command: "ls" })).toBe("ask");
  });

  it("maps Codex thread policy to a sandbox, and keeps Codex asking us", () => {
    const sandboxes = Object.fromEntries(MODES.map((mode) => [mode, codexThreadPolicy(mode)]));

    expect(sandboxes.plan?.sandbox).toBe("read-only");
    expect(sandboxes.default?.sandbox).toBe("workspace-write");
    expect(sandboxes.acceptEdits?.sandbox).toBe("workspace-write");
    expect(sandboxes.bypassPermissions?.sandbox).toBe("danger-full-access");

    // Codex must keep asking us even in bypass mode; otherwise the mode would
    // mean something different than it does for Claude, and approvals would
    // stop being visible to the user.
    for (const mode of MODES) {
      expect(sandboxes[mode]?.approvalPolicy).toBe("on-request");
    }
  });
});
