import { describe, expect, it } from "vitest";
import {
  type AppServerSkill,
  codexUserInput,
  toCodexSkillCommand,
} from "../../../src/sdk/providers/codex.js";

const skill = (name: string, scope: AppServerSkill["scope"] = "user"): AppServerSkill => ({
  name,
  description: `${name} long description`,
  path: `/skills/${name}/SKILL.md`,
  scope,
  enabled: true,
});

describe("Codex skills", () => {
  it("offers skills as $mentions usable anywhere in the message", () => {
    expect(
      toCodexSkillCommand({
        ...skill("lit-review", "repo"),
        interface: { shortDescription: "Review" },
      }),
    ).toEqual({
      name: "lit-review",
      description: "Review",
      source: "project",
      trigger: "$",
      position: "anywhere",
    });
  });

  it("sends each mentioned skill as a native skill input next to the text", () => {
    const text = "Use $lit-review then $cite, not a$price or $unknown";
    expect(codexUserInput(text, [skill("lit-review"), skill("cite"), skill("price")])).toEqual([
      { type: "text", text, text_elements: [] },
      { type: "skill", name: "lit-review", path: "/skills/lit-review/SKILL.md" },
      { type: "skill", name: "cite", path: "/skills/cite/SKILL.md" },
    ]);
  });

  it("sends a repeated mention once", () => {
    expect(codexUserInput("$cite and $cite", [skill("cite")])).toHaveLength(2);
  });
});
