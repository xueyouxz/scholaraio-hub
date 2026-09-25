import { describe, expect, it } from "vitest";
import { keyPage } from "../components/LibrarySettingsForm";

describe("keyPage", () => {
  it("links known providers to their key page and others to their site", () => {
    expect(keyPage("https://api.deepseek.com")).toBe("https://platform.deepseek.com/api_keys");
    expect(keyPage("https://api.openai.com/v1")).toBe("https://platform.openai.com/api-keys");
    expect(keyPage("https://llm.example.org/v1")).toBe("https://llm.example.org");
    expect(keyPage("not a url")).toBeNull();
  });
});
