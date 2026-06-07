import { describe, expect, it } from "vitest";
import { getSubagentRoute } from "../subagentRouting";

describe("getSubagentRoute", () => {
  it("routes legacy parentToolUseId messages under the parent tool id", () => {
    expect(getSubagentRoute({ isSubagent: true, parentToolUseId: "tool-1" })).toEqual({
      agentId: "tool-1",
      toolUseId: "tool-1",
    });
  });

  it("routes new sidechain messages under agentId without inventing a tool mapping", () => {
    expect(getSubagentRoute({ isSubagent: true, agentId: "agent-1" })).toEqual({
      agentId: "agent-1",
    });
  });

  it("uses real agentId for storage and parent tool id for lookup when both exist", () => {
    expect(
      getSubagentRoute({
        isSubagent: true,
        parentToolUseId: "tool-1",
        agentId: "agent-1",
      }),
    ).toEqual({
      agentId: "agent-1",
      toolUseId: "tool-1",
    });
  });

  it("ignores non-subagent messages", () => {
    expect(getSubagentRoute({ agentId: "agent-1" })).toBeNull();
  });
});
