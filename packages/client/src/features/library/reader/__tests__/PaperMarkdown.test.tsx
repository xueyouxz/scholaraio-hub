import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PaperMarkdown } from "../PaperMarkdown";

const render = (content: string) =>
  renderToStaticMarkup(<PaperMarkdown content={content} paperId="p1" />);

describe("PaperMarkdown", () => {
  it("keeps the HTML tables and formulas a parsed paper contains", () => {
    const html = render(
      '<table><tr><td colspan="2">cell</td></tr></table>\n\nInline $E=mc^2$ math.\n\n$$\na^2+b^2\n$$',
    );
    expect(html).toContain("<table ");
    expect(html).toContain('<td colSpan="2">cell</td>');
    expect(html).toContain('class="katex"');
    expect(html).toContain('class="katex-display"');
  });

  it("drops markup that could run script from a malicious PDF", () => {
    const html = render(
      [
        '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
        '<img src="x" onerror="alert(1)">',
        '<a href="javascript:alert(1)">link</a>',
        '<base href="https://attacker.example/">',
        '<meta http-equiv="refresh" content="0;url=https://attacker.example">',
        "<svg><foreignObject><div>svg</div></foreignObject></svg>",
      ].join("\n\n"),
    );
    for (const unsafe of ["<iframe", "onerror", "javascript:", "<base", "<meta", "<svg"])
      expect(html).not.toContain(unsafe);
  });
});
