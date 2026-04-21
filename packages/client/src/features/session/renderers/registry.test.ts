import { describe, expect, it } from "vitest";
import { RendererRegistry } from "./registry";
import type { ContentRenderer } from "./types";

const fallback: ContentRenderer = {
  type: [],
  render: () => "fallback",
};

describe("RendererRegistry", () => {
  it("returns fallback when no renderer is registered", () => {
    const registry = new RendererRegistry(fallback);
    const renderer = registry.getRenderer({ type: "text" });
    expect(renderer).toBe(fallback);
  });

  it("registers and retrieves a renderer by single type", () => {
    const registry = new RendererRegistry(fallback);
    const text: ContentRenderer = { type: "text", render: () => "text" };
    registry.register(text);
    expect(registry.getRenderer({ type: "text" })).toBe(text);
  });

  it("registers a renderer for multiple types", () => {
    const registry = new RendererRegistry(fallback);
    const multi: ContentRenderer = { type: ["text", "thinking"], render: () => "multi" };
    registry.register(multi);
    expect(registry.getRenderer({ type: "text" })).toBe(multi);
    expect(registry.getRenderer({ type: "thinking" })).toBe(multi);
  });
});
