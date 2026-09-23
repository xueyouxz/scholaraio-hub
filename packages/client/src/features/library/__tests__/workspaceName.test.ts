import { describe, expect, it } from "vitest";
import { nameProblem } from "../components/WorkspaceCreateDialog";

/** The same rules the library applies before it makes the directory. */
describe("nameProblem", () => {
  it("accepts an ordinary name", () => {
    expect(nameProblem("湍流减阻综述")).toBeNull();
    expect(nameProblem("review-2026")).toBeNull();
  });

  it("refuses what a directory name cannot be", () => {
    expect(nameProblem("")).not.toBeNull();
    expect(nameProblem(" 前导空格")).not.toBeNull();
    expect(nameProblem("尾随空格 ")).not.toBeNull();
    expect(nameProblem(".")).not.toBeNull();
    expect(nameProblem("..")).not.toBeNull();
    expect(nameProblem(".hidden")).not.toBeNull();
    expect(nameProblem("a/b")).not.toBeNull();
    expect(nameProblem("a\\b")).not.toBeNull();
    expect(nameProblem("C:project")).not.toBeNull();
    expect(nameProblem("up..dir")).not.toBeNull();
    expect(nameProblem("line\nbreak")).not.toBeNull();
    expect(nameProblem("x".repeat(121))).not.toBeNull();
  });
});
