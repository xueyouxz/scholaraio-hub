import type { ReactNode } from "react";
import type { ContentBlock, ContentRenderer, RenderContext } from "./types";

export class RendererRegistry {
  private renderers = new Map<string, ContentRenderer>();
  private fallback: ContentRenderer;

  constructor(fallback: ContentRenderer) {
    this.fallback = fallback;
  }

  register(renderer: ContentRenderer): void {
    const types = Array.isArray(renderer.type) ? renderer.type : [renderer.type];
    for (const type of types) {
      this.renderers.set(type, renderer);
    }
  }

  getRenderer(block: ContentBlock): ContentRenderer {
    return this.renderers.get(block.type) || this.fallback;
  }

  render(block: ContentBlock, context: RenderContext): ReactNode {
    return this.getRenderer(block).render(block, context);
  }
}
