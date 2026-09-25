import "katex/dist/katex.min.css";
import { memo, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { paperAssetUrl } from "../paperSummary";

interface Props {
  content: string;
  paperId: string;
  highlightedLine?: number;
}

/** 将 paper.md 中的相对图片路径 `images/xxx` 替换为可访问的绝对 API 路径。 */
function rewriteImageUrls(content: string, paperId: string): string {
  return content.replace(
    /!\[([^\]]*)\]\(images\/([^)\s]+)\)/g,
    (_, alt: string, filename: string) => `![${alt}](${paperAssetUrl(paperId, filename)})`,
  );
}

// ─── Custom image component with lightbox ─────────────────────────────────────

function PaperImage({ src, alt }: { src?: string; alt?: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);
  if (!src) return null;

  const openLightbox = () => setOpen(true);
  const closeLightbox = () => setOpen(false);

  return (
    <>
      <span className="not-prose block my-5">
        <button
          type="button"
          aria-label={alt ? `放大图片：${alt}` : "放大图片"}
          onClick={openLightbox}
          className="block w-full text-left p-0 border-0 bg-transparent cursor-zoom-in"
        >
          <img
            src={src}
            alt={alt ?? ""}
            loading="lazy"
            className="max-w-full rounded-lg border border-outline-variant/20 hover:opacity-90 transition-opacity"
          />
        </button>
        {alt ? (
          <span className="block mt-1.5 text-[11px] font-mono text-on-surface-variant/70 leading-snug">
            {alt}
          </span>
        ) : null}
      </span>

      {open && (
        <button
          type="button"
          className="fixed inset-0 z-50 flex items-center justify-center bg-on-surface/60 backdrop-blur-sm w-full border-0 cursor-zoom-out"
          aria-label="关闭图片预览"
          onClick={closeLightbox}
        >
          <img
            src={src}
            alt={alt ?? ""}
            className="max-w-[90vw] max-h-[90vh] rounded-xl shadow-2xl object-contain"
          />
        </button>
      )}
    </>
  );
}

// ─── Source lines ─────────────────────────────────────────────────────────────

interface SourceNode {
  type: string;
  properties?: Record<string, unknown>;
  position?: { start: { line: number }; end: { line: number } };
}

/**
 * Tag each top-level block with the paper.md lines it came from.
 *
 * The reader saves its place and follows citations by line, so every block the
 * reader can land on carries `data-line` / `data-end-line`, and the block that
 * holds a cited line is marked.
 */
function rehypeSourceLines({ highlight }: { highlight?: number }) {
  return (tree: { children: SourceNode[] }) => {
    for (const node of tree.children) {
      if (node.type !== "element" || !node.position) continue;
      const { start, end } = node.position;
      const marked = highlight !== undefined && start.line <= highlight && end.line >= highlight;
      node.properties = {
        ...node.properties,
        id: `line-${start.line}`,
        dataLine: start.line,
        dataEndLine: end.line,
        ...(marked ? { className: [...classNames(node), "bg-secondary-container"] } : {}),
      };
    }
  };
}

function classNames(node: SourceNode): string[] {
  const value = node.properties?.className;
  return Array.isArray(value) ? value.map(String) : [];
}

// ─── Main component ───────────────────────────────────────────────────────────

/**
 * A paper's full text, set by Tailwind Typography.
 *
 * `prose` owns the typesetting; the palette comes in through `paper-prose` in
 * styles.css. MinerU writes every section heading as `#`, so heading sizes are
 * pulled in to keep a flat outline from shouting.
 */
export const PaperMarkdown = memo(function PaperMarkdown({
  content,
  paperId,
  highlightedLine,
}: Props) {
  return (
    <div className="paper-prose prose prose-sm max-w-none break-words prose-h1:text-xl prose-h2:text-lg prose-h3:text-base prose-code:before:content-none prose-code:after:content-none">
      <ReactMarkdown
        disallowedElements={["script", "iframe", "object", "embed", "form", "input", "style"]}
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[
          rehypeRaw,
          [rehypeKatex, { strict: false, throwOnError: false }],
          [rehypeSourceLines, { highlight: highlightedLine }],
        ]}
        components={{
          a: ({ node: _node, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer" />
          ),
          // Wide tables scroll inside the column instead of pushing it wider.
          table: ({ node: _node, ...props }) => (
            <div className="overflow-x-auto">
              <table {...props} />
            </div>
          ),
          img: ({ src, alt }) => (
            <PaperImage src={typeof src === "string" ? src : undefined} alt={alt} />
          ),
        }}
      >
        {rewriteImageUrls(content, paperId)}
      </ReactMarkdown>
    </div>
  );
});
