import type { SlashCommand } from "@scholaraio-hub/shared";
import { describe, expect, it } from "vitest";
import {
  filterCommands,
  findLeadingCommand,
  joinLeadingCommand,
  splitLeadingCommand,
  toggleLeadingCommand,
  withCommandArguments,
} from "../slashCommands";

const command = (name: string): SlashCommand => ({ name, description: name });

describe("filterCommands", () => {
  it("keeps prefix matches case-insensitively in original order", () => {
    const list = [command("Review"), command("commit"), command("research")];
    expect(filterCommands(list, "RE").map((c) => c.name)).toEqual(["Review", "research"]);
  });
});

describe("findLeadingCommand", () => {
  it("prefers the longest matching name", () => {
    const list = [command("pr"), command("pr-review")];
    expect(findLeadingCommand("/pr-review now", list)?.name).toBe("pr-review");
    expect(findLeadingCommand("/pr", list)?.name).toBe("pr");
  });

  it("does not match a name that is only a prefix of the typed token", () => {
    expect(findLeadingCommand("/prx", [command("pr")])).toBeNull();
  });
});

describe("splitLeadingCommand", () => {
  const review = command("review");

  it("shows a badge once the command is followed by a space", () => {
    expect(splitLeadingCommand("/review ", review, false)).toEqual({ token: "/review", body: "" });
    expect(splitLeadingCommand("/review  two", review, false)).toEqual({
      token: "/review",
      body: " two",
    });
  });

  it("shows the bare token as a badge only once confirmed", () => {
    expect(splitLeadingCommand("/review", review, false)).toEqual({ token: "", body: "/review" });
    expect(splitLeadingCommand("/review", review, true)).toEqual({ token: "/review", body: "" });
  });

  it("round-trips through joinLeadingCommand", () => {
    const { token, body } = splitLeadingCommand("/review fix it", review, false);
    expect(joinLeadingCommand(token, body)).toBe("/review fix it");
    expect(joinLeadingCommand(token, "")).toBe("/review ");
    expect(joinLeadingCommand("", "plain")).toBe("plain");
  });
});

describe("toggleLeadingCommand", () => {
  it("leads the message with the command, keeping what was written", () => {
    expect(toggleLeadingCommand("summarize it", null, "review")).toBe("/review summarize it");
    expect(toggleLeadingCommand("", null, "review")).toBe("/review ");
  });

  it("replaces the command the message leads with", () => {
    expect(toggleLeadingCommand("/review fix it", "review", "audit")).toBe("/audit fix it");
    expect(toggleLeadingCommand("/review", "review", "audit")).toBe("/audit ");
  });

  it("takes the same command off again", () => {
    expect(toggleLeadingCommand("/review fix it", "review", "review")).toBe("fix it");
    expect(toggleLeadingCommand("/review", "review", "review")).toBe("");
  });
});

describe("withCommandArguments", () => {
  it("puts the arguments between the command and the rest", () => {
    expect(withCommandArguments("/read why", "read", ["a", "b"])).toBe("/read a b why");
    expect(withCommandArguments("/read", "read", ["a"])).toBe("/read a");
  });

  it("leaves a message without that command, or without arguments, as it is", () => {
    expect(withCommandArguments("why /read", "read", ["a"])).toBe("why /read");
    expect(withCommandArguments("/read why", "read", [])).toBe("/read why");
  });
});
