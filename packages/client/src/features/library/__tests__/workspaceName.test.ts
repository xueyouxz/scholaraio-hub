import { describe, expect, it } from "vitest";
import { workspaceNameProblem } from "../workspaceName";

/** The same rules the library applies before it makes the directory. */
describe("workspaceNameProblem", () => {
  it("accepts an ordinary name", () => {
    expect(workspaceNameProblem("湍流减阻综述")).toBeNull();
    expect(workspaceNameProblem("review-2026")).toBeNull();
  });

  it("refuses what a directory name cannot be", () => {
    expect(workspaceNameProblem("")).not.toBeNull();
    expect(workspaceNameProblem(" 前导空格")).not.toBeNull();
    expect(workspaceNameProblem("尾随空格 ")).not.toBeNull();
    expect(workspaceNameProblem(".")).not.toBeNull();
    expect(workspaceNameProblem("..")).not.toBeNull();
    expect(workspaceNameProblem(".hidden")).not.toBeNull();
    expect(workspaceNameProblem("a/b")).not.toBeNull();
    expect(workspaceNameProblem("a\\b")).not.toBeNull();
    expect(workspaceNameProblem("C:project")).not.toBeNull();
    expect(workspaceNameProblem("up..dir")).not.toBeNull();
    expect(workspaceNameProblem("line\nbreak")).not.toBeNull();
    expect(workspaceNameProblem("x".repeat(121))).not.toBeNull();
  });
});
