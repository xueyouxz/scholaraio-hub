import { type LibraryCitation, readNotice } from "@scholaraio-hub/shared";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { Part, PartOf, TimelinePartType, ToolPart } from "../../lib/parts";
import { citationUrl, linkCitations } from "../../lib/turnTree";
import { ReasoningPart } from "./ReasoningPart";
import { TextPart } from "./TextPart";

/** What a part renderer may use besides the part itself. */
export interface PartContext {
  /** This part is the one currently streaming. */
  active: boolean;
  citations: readonly LibraryCitation[];
  /** Tool calls carry turn-level state (nesting, a pending decision), so the turn draws them. */
  renderToolCall(part: ToolPart): ReactNode;
}

type PartRenderer<T extends TimelinePartType> = (
  part: PartOf<T>,
  context: PartContext,
) => ReactNode;

/**
 * How each timeline part type is drawn. Tool calls are further dispatched by
 * tool name in `renderers/registry.tsx`. Every renderer returns one element
 * with the `timeline-item` class, or nothing.
 */
const PART_RENDERERS: { [T in TimelinePartType]: PartRenderer<T> } = {
  text: (part, { active, citations }) => (
    <TextPart text={linkCitations(part.text, citations)} streaming={active} />
  ),
  reasoning: (part, { active }) => <ReasoningPart text={part.text} streaming={active} />,
  "dynamic-tool": (part, { renderToolCall }) => renderToolCall(part),
  "data-notice": (part) => {
    const notice = readNotice(part.data);
    return (
      <div className={`text-block timeline-item notice notice-${notice.level}`}>
        <output className={notice.level === "error" ? "text-error" : "text-on-surface-variant"}>
          {notice.text}
        </output>
      </div>
    );
  },
  file: (part) => (
    <div className="text-block timeline-item">
      <a className="uploaded-file" href={part.url} target="_blank" rel="noreferrer">
        📎 {part.filename || "查看附件"}
      </a>
    </div>
  ),
};

export function renderPart(part: Part, context: PartContext): ReactNode {
  const render = (PART_RENDERERS as Partial<Record<Part["type"], PartRenderer<TimelinePartType>>>)[
    part.type
  ];
  return render ? render(part as PartOf<TimelinePartType>, context) : null;
}

/** The passages a turn cites, after its last item. */
export function CitationList({ citations }: { citations: readonly LibraryCitation[] }) {
  return (
    <details className="text-block timeline-item text-xs">
      <summary className="cursor-pointer text-primary">参考文献片段（{citations.length}）</summary>
      <ul className="mt-2 space-y-2">
        {citations.map((citation) => (
          <li key={citation.id}>
            <Link className="text-primary hover:underline" to={citationUrl(citation)}>
              [{citation.id.slice(4)}] {citation.title} · 第 {citation.startLine}–{citation.endLine}{" "}
              行
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}
