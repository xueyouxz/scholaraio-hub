import type { LibraryCitation, SessionMessage } from "@scholaraio-hub/shared";
import { Suspense, lazy, useState } from "react";
import { Link } from "react-router-dom";
import { Markdown } from "../../../shared/components/Markdown";

const SessionDiff = lazy(() =>
  import("./SessionDiff").then((module) => ({ default: module.SessionDiff })),
);
export function citationUrl(citation: LibraryCitation): string {
  return `/library/${encodeURIComponent(citation.paperId)}?mode=markdown&line=${citation.startLine}`;
}
export function SessionMessages({
  messages,
  streaming,
}: { messages: SessionMessage[]; streaming: boolean }) {
  return (
    <>
      {messages.map((message, index) => {
        const citations = message.parts.flatMap((part) =>
          part.type === "data-citations" ? part.data : [],
        );
        const withCitations = (text: string) =>
          text.replace(/\[(ref-\d+)\]/g, (original, id: string) => {
            const citation = citations.find((item) => item.id === id);
            return citation ? `[${id.slice(4)}](${citationUrl(citation)})` : original;
          });
        return (
          <article
            key={message.id}
            className={`py-5 ${message.role === "user" ? "bg-surface-container-low rounded-xl px-5" : ""}`}
          >
            <p className="text-xs font-mono text-on-surface-variant mb-3">
              {message.role === "user" ? "你" : "AI"}
            </p>
            {message.parts.map((part, partIndex) => {
              const key = `${message.id}-${partIndex}`;
              if (part.type === "text")
                return (
                  <Markdown
                    key={key}
                    text={withCitations(part.text)}
                    streaming={streaming && index === messages.length - 1}
                  />
                );
              if (part.type === "reasoning")
                return (
                  <details key={key} className="text-on-surface-variant my-2">
                    <summary className="cursor-pointer text-xs">思考过程</summary>
                    <Markdown text={part.text} />
                  </details>
                );
              if (part.type === "dynamic-tool") return <ToolMessage key={key} part={part} />;
              if (part.type === "data-notice")
                return (
                  <output key={key} className="text-sm text-on-surface-variant mt-2">
                    {part.data}
                  </output>
                );
              if (part.type === "file")
                return (
                  <a
                    key={key}
                    className="text-primary underline"
                    href={part.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    查看附件
                  </a>
                );
              return null;
            })}
            {citations.length ? (
              <details className="mt-4 text-xs">
                <summary className="cursor-pointer text-primary">
                  参考文献片段（{citations.length}）
                </summary>
                <ul className="mt-2 space-y-2">
                  {citations.map((citation) => (
                    <li key={citation.id}>
                      <Link className="text-primary hover:underline" to={citationUrl(citation)}>
                        [{citation.id.slice(4)}] {citation.title} · 第 {citation.startLine}–
                        {citation.endLine} 行
                      </Link>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </article>
        );
      })}
    </>
  );
}

function ToolMessage({
  part,
}: { part: Extract<SessionMessage["parts"][number], { type: "dynamic-tool" }> }) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="rounded-xl border border-outline-variant/20 p-3 my-3"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer text-xs">
        {part.toolName} · {part.state}
      </summary>
      {open ? (
        <>
          <pre className="whitespace-pre-wrap break-all text-xs p-2 max-h-80 overflow-auto">
            {JSON.stringify(part.input, null, 2)}
          </pre>
          <Suspense fallback={<span>加载差异…</span>}>
            <SessionDiff input={part.input} />
          </Suspense>
          {"output" in part ? (
            <pre className="text-xs p-2 whitespace-pre-wrap break-all max-h-80 overflow-auto">
              {typeof part.output === "string" ? part.output : JSON.stringify(part.output, null, 2)}
            </pre>
          ) : null}
          {"errorText" in part ? <p className="text-error">{String(part.errorText)}</p> : null}
        </>
      ) : null}
    </details>
  );
}
