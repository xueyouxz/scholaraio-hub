import type { SlashCommand } from "@scholaraio-hub/shared";
import { describe, expect, it } from "vitest";
import {
  filterCommands,
  findLeadingCommand,
  joinLeadingCommand,
  splitLeadingCommand,
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
