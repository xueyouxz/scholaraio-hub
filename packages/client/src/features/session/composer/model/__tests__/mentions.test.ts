import { describe, expect, it } from "vitest";
import { mentionReplacement, mentionTokenAt } from "../mentions";

describe("@ mentions", () => {
  it("finds the mention at the caret, only at the start or after whitespace", () => {
    expect(mentionTokenAt("看 @综述", 5)).toEqual({ start: 2, end: 5, query: "综述" });
    expect(mentionTokenAt("@", 1)).toEqual({ start: 0, end: 1, query: "" });
    expect(mentionTokenAt("mail a@b.c", 10)).toBeNull();
    expect(mentionTokenAt("@abc def", 8)).toBeNull();
  });

  it("writes the chosen name without spaces, so it reads as one mention", () => {
    expect(
      mentionReplacement({ ref: { kind: "paper", id: "p" }, label: "Deep  Learning Review" }),
    ).toBe("@Deep_Learning_Review ");
  });
});
