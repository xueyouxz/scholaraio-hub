import { describe, expect, it } from "vitest";
import { collectionNameProblem } from "../collectionName";

/** The same rules the library applies before it makes the directory. */
describe("collectionNameProblem", () => {
  it("accepts an ordinary name", () => {
    expect(collectionNameProblem("湍流减阻综述")).toBeNull();
    expect(collectionNameProblem("review-2026")).toBeNull();
  });

  it("refuses what a directory name cannot be", () => {
    expect(collectionNameProblem("")).not.toBeNull();
    expect(collectionNameProblem(" 前导空格")).not.toBeNull();
    expect(collectionNameProblem("尾随空格 ")).not.toBeNull();
    expect(collectionNameProblem(".")).not.toBeNull();
    expect(collectionNameProblem("..")).not.toBeNull();
    expect(collectionNameProblem(".hidden")).not.toBeNull();
    expect(collectionNameProblem("a/b")).not.toBeNull();
    expect(collectionNameProblem("a\\b")).not.toBeNull();
    expect(collectionNameProblem("C:project")).not.toBeNull();
    expect(collectionNameProblem("up..dir")).not.toBeNull();
    expect(collectionNameProblem("line\nbreak")).not.toBeNull();
    expect(collectionNameProblem("x".repeat(121))).not.toBeNull();
  });
});
