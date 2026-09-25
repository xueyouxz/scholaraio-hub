import { beforeEach, describe, expect, it } from "vitest";
import { readComposerPreference, rememberComposerChoice } from "../preferences";

beforeEach(() => localStorage.clear());

describe("composer preferences", () => {
  it("remembers the model and permission mode per agent", () => {
    rememberComposerChoice("claude", { model: "opus", thinking: "off" });
    rememberComposerChoice("claude", { permissionMode: "plan" });
    expect(readComposerPreference("claude")).toEqual({ model: "opus", permissionMode: "plan" });
    expect(readComposerPreference("codex")).toEqual({});
  });

  it("ignores patches that change neither", () => {
    rememberComposerChoice("codex", { effort: "high" });
    expect(readComposerPreference("codex")).toEqual({});
  });

  it("survives unreadable storage", () => {
    localStorage.setItem("hub-composer:choice:claude", "{not json");
    expect(readComposerPreference("claude")).toEqual({});
  });
});
