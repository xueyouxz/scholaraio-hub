import { beforeEach, describe, expect, it } from "vitest";
import { readComposerPreference, rememberComposerChoice } from "../preferences";

beforeEach(() => localStorage.clear());

describe("composer preferences", () => {
  it("remembers the model, permission mode, thinking and effort per agent", () => {
    rememberComposerChoice("claude", { model: "opus", thinking: "off" });
    rememberComposerChoice("claude", { permissionMode: "plan" });
    rememberComposerChoice("claude", { effort: "high" });
    expect(readComposerPreference("claude")).toEqual({
      model: "opus",
      permissionMode: "plan",
      thinking: "off",
      effort: "high",
    });
    expect(readComposerPreference("codex")).toEqual({});
  });

  it("keeps a return to the default effort, and ignores empty patches", () => {
    rememberComposerChoice("codex", { effort: "high" });
    rememberComposerChoice("codex", { effort: "" });
    rememberComposerChoice("codex", {});
    expect(readComposerPreference("codex")).toEqual({ effort: "" });
  });

  it("survives unreadable storage", () => {
    localStorage.setItem("hub-composer:choice:claude", "{not json");
    expect(readComposerPreference("claude")).toEqual({});
  });
});
