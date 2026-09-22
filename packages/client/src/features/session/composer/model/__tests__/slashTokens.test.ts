import type { SlashCommand } from "@scholaraio-hub/shared";
import { describe, expect, it } from "vitest";
import {
  commandsForToken,
  dedupeCommands,
  replaceToken,
  slashTokenAt,
  tokenReplacement,
} from "../slashCommands";

const compact: SlashCommand = { name: "compact", description: "", position: "leading" };
const cite: SlashCommand = { name: "cite", description: "", trigger: "$", position: "anywhere" };

describe("slashTokenAt", () => {
  it("finds the /word at the caret, leading or after whitespace", () => {
    expect(slashTokenAt("/com", 4)).toEqual({ start: 0, end: 4, query: "com", leading: true });
    expect(slashTokenAt("please /ci now", 10)).toEqual({
      start: 7,
      end: 10,
      query: "ci",
      leading: false,
    });
    expect(slashTokenAt("line\n/c", 7)?.leading).toBe(false);
  });

  it("ignores slashes inside words and paths", () => {
    expect(slashTokenAt("a/b", 3)).toBeNull();
    expect(slashTokenAt("/usr/bin", 8)).toBeNull();
    expect(slashTokenAt("hello", 5)).toBeNull();
  });
});

describe("commandsForToken", () => {
  it("offers leading-only commands only at the start of the message", () => {
    const commands = [compact, { ...cite, name: "compare" }];
    expect(
      commandsForToken(commands, { start: 0, end: 3, query: "co", leading: true }),
    ).toHaveLength(2);
    expect(
      commandsForToken(commands, { start: 4, end: 7, query: "co", leading: false }).map(
        (c) => c.name,
      ),
    ).toEqual(["compare"]);
  });
});

describe("replaceToken", () => {
  it("puts the provider's invocation in place of the typed token", () => {
    const token = slashTokenAt("use /ci please", 7);
    expect(token).not.toBeNull();
    if (!token) return;
    expect(replaceToken("use /ci please", token, tokenReplacement(cite))).toEqual({
      text: "use $cite please",
      caret: 10,
    });
    expect(tokenReplacement(compact)).toBe("/compact ");
  });
});

describe("dedupeCommands", () => {
  it("lets earlier lists win per invocation form", () => {
    const client = { name: "model", description: "client", source: "client" as const };
    const provider = { name: "model", description: "provider" };
    const skill = { name: "model", description: "skill", trigger: "$" as const };
    expect(dedupeCommands([client], [provider, skill]).map((c) => c.description)).toEqual([
      "client",
      "skill",
    ]);
  });
});
