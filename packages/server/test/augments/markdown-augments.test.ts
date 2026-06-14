import { describe, expect, it } from "vitest";
import {
  renderMarkdownToHtml,
  warmMarkdownAugments,
} from "../../src/augments/markdown-augments.js";

describe("markdown-augments", () => {
  it("warmMarkdownAugments resolves and primes the highlighter", async () => {
    // Should not throw and should leave the shared pipeline ready to render.
    await expect(warmMarkdownAugments()).resolves.toBeUndefined();
  });

  it("renders fenced code with shiki highlighting after warmup", async () => {
    await warmMarkdownAugments();
    const html = await renderMarkdownToHtml("```ts\nconst x = 1;\n```");
    // Shiki wraps highlighted code in <pre class="shiki"> with token spans.
    expect(html).toContain("<pre");
    expect(html).toContain("shiki");
    expect(html).toContain("<span");
  });

  it("produces identical output across repeated calls (shared highlighter is stable)", async () => {
    const markdown = "Here is code:\n\n```ts\nconst y: number = 2;\n```";
    const first = await renderMarkdownToHtml(markdown);
    const second = await renderMarkdownToHtml(markdown);
    expect(second).toBe(first);
  });

  it("returns empty string for blank input", async () => {
    expect(await renderMarkdownToHtml("   ")).toBe("");
  });
});
