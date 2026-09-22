import "katex/dist/katex.min.css";
import { memo, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { buildPaperImageUrl } from "../paperUtils";

interface Props {
  content: string;
  paperId: string;
  highlightedLine?: number;
}

/** 将 paper.md 中的相对图片路径 `images/xxx` 替换为可访问的绝对 API 路径。 */
function rewriteImageUrls(content: string, paperId: string): string {
  return content.replace(
    /!\[([^\]]*)\]\(images\/([^)\s]+)\)/g,
    (_, alt: string, filename: string) => `![${alt}](${buildPaperImageUrl(paperId, filename)})`,
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
      <span className="block my-5">
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

// ─── Main component ───────────────────────────────────────────────────────────

export const PaperMarkdown = memo(function PaperMarkdown({
  content,
  paperId,
  highlightedLine,
}: Props) {
  const rewritten = rewriteImageUrls(content, paperId);
  const source = (node?: { position?: { start: { line: number }; end: { line: number } } }) => {
    const position = node?.position;
    return position
      ? {
          id: `line-${position.start.line}`,
          "data-line": position.start.line,
          "data-end-line": position.end.line,
          style:
            highlightedLine &&
            position.start.line <= highlightedLine &&
            position.end.line >= highlightedLine
              ? { backgroundColor: "var(--color-secondary-container)" }
              : undefined,
        }
      : {};
  };

  return (
    <ReactMarkdown
      disallowedElements={["script", "iframe", "object", "embed", "form", "input", "style"]}
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeRaw, [rehypeKatex, { strict: false, throwOnError: false }]]}
      components={{
        h1: ({ children, node }) => (
          <h1
            {...source(node)}
            className="font-serif text-xl font-bold text-on-surface leading-snug mt-8 mb-3 first:mt-0"
          >
            {children}
          </h1>
        ),
        h2: ({ children, node }) => (
          <h2
            {...source(node)}
            className="font-serif text-lg font-bold text-on-surface leading-snug mt-7 mb-2.5"
          >
            {children}
          </h2>
        ),
        h3: ({ children, node }) => (
          <h3
            {...source(node)}
            className="font-serif text-base font-semibold text-on-surface leading-snug mt-6 mb-2"
          >
            {children}
          </h3>
        ),
        h4: ({ children, node }) => (
          <h4
            {...source(node)}
            className="font-serif text-sm font-semibold text-on-surface leading-snug mt-5 mb-1.5"
          >
            {children}
          </h4>
        ),
        h5: ({ children, node }) => (
          <h5
            {...source(node)}
            className="font-serif text-sm font-medium text-on-surface leading-snug mt-4 mb-1"
          >
            {children}
          </h5>
        ),
        h6: ({ children, node }) => (
          <h6
            {...source(node)}
            className="font-mono text-[10px] uppercase tracking-widest text-on-surface-variant mt-4 mb-1"
          >
            {children}
          </h6>
        ),
        p: ({ children, node }) => (
          <p {...source(node)} className="text-sm text-on-surface leading-relaxed mb-3">
            {children}
          </p>
        ),
        a: ({ href, children }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline underline-offset-2 hover:opacity-80 transition-opacity"
          >
            {children}
          </a>
        ),
        ul: ({ children, node }) => (
          <ul
            {...source(node)}
            className="list-disc list-outside pl-5 mb-3 space-y-1 text-sm text-on-surface"
          >
            {children}
          </ul>
        ),
        ol: ({ children, node }) => (
          <ol
            {...source(node)}
            className="list-decimal list-outside pl-5 mb-3 space-y-1 text-sm text-on-surface"
          >
            {children}
          </ol>
        ),
        li: ({ children }) => <li className="leading-relaxed">{children}</li>,
        blockquote: ({ children, node }) => (
          <blockquote
            {...source(node)}
            className="border-l-4 border-primary/30 pl-4 my-4 text-on-surface-variant italic"
          >
            {children}
          </blockquote>
        ),
        hr: () => <hr className="border-0 border-t border-outline-variant/15 my-6" />,
        code: ({ children, className }) => {
          const isBlock = className?.startsWith("language-");
          if (isBlock) {
            return (
              <code className="block font-mono text-xs text-on-surface leading-relaxed whitespace-pre-wrap break-words">
                {children}
              </code>
            );
          }
          return (
            <code className="font-mono text-[11px] text-on-surface bg-surface-container-high px-1 py-0.5 rounded">
              {children}
            </code>
          );
        },
        pre: ({ children, node }) => (
          <pre
            {...source(node)}
            className="bg-surface-container-high rounded-lg px-4 py-3 my-3 overflow-x-auto border border-outline-variant/10"
          >
            {children}
          </pre>
        ),
        table: ({ children, node }) => (
          <div className="overflow-x-auto my-4">
            <table {...source(node)} className="w-full text-sm border-collapse">
              {children}
            </table>
          </div>
        ),
        thead: ({ children }) => (
          <thead className="border-b border-outline-variant/20">{children}</thead>
        ),
        tbody: ({ children }) => (
          <tbody className="divide-y divide-outline-variant/10">{children}</tbody>
        ),
        tr: ({ children }) => <tr className="hover:bg-surface-container/50">{children}</tr>,
        th: ({ children, rowSpan, colSpan }) => (
          <th
            rowSpan={rowSpan}
            colSpan={colSpan}
            className="text-left text-[10px] font-mono uppercase tracking-widest text-on-surface-variant px-3 py-2 font-semibold"
          >
            {children}
          </th>
        ),
        td: ({ children, rowSpan, colSpan }) => (
          <td
            rowSpan={rowSpan}
            colSpan={colSpan}
            className="text-on-surface px-3 py-2 leading-relaxed"
          >
            {children}
          </td>
        ),
        img: ({ src, alt }) => <PaperImage src={src} alt={alt} />,
      }}
    >
      {rewritten}
    </ReactMarkdown>
  );
});
