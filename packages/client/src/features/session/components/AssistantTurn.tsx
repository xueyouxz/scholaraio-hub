import type { InputRequest, SessionMessage } from "@scholaraio-hub/shared";
import { type ReactNode, memo, useMemo } from "react";
import { ErrorBoundary } from "../../../shared/ui/ErrorBoundary";
import type { Segment } from "../lib/exploration";
import type { ToolPart } from "../lib/parts";
import { buildTurnTree } from "../lib/turnTree";
import { CitationList, type PartContext, renderPart } from "./parts/registry";
import { ExploredGroup } from "./renderers/ExploredGroup";
import { InlineInputRequest } from "./renderers/InlineInputRequest";
import { ToolCallRow, describeToolCall } from "./renderers/ToolCallRow";

/**
 * One assistant message as a timeline. Finished turns keep their message
 * object between stream updates, so memo skips them entirely; only the turn
 * being streamed re-renders.
 */
export const AssistantTurn = memo(function AssistantTurn({
  message,
  streaming,
  pendingInput,
  sessionId,
  onInputDone,
}: {
  message: SessionMessage;
  streaming: boolean;
  /** A decision the agent waits on, asked on its tool call's row. */
  pendingInput?: InputRequest;
  sessionId?: string;
  onInputDone?: () => void;
}) {
  const turn = useMemo(() => buildTurnTree(message.parts), [message.parts]);
  const lastIndex = message.parts.length - 1;

  const renderToolCall = (part: ToolPart): ReactNode => {
    const nested = turn.nested.get(part.toolCallId);
    const latest = nested?.tools.at(-1);
    return (
      <ToolCallRow
        part={part}
        streaming={streaming}
        nested={
          nested
            ? {
                node: <div className="nested-timeline">{timeline(nested.segments)}</div>,
                toolCount: nested.tools.length,
                latest: latest ? describeToolCall(latest, streaming) : undefined,
              }
            : undefined
        }
        interaction={
          pendingInput && sessionId && pendingInput.toolCallId === part.toolCallId ? (
            <InlineInputRequest
              key={pendingInput.id}
              request={pendingInput}
              sessionId={sessionId}
              onDone={onInputDone ?? (() => {})}
            />
          ) : undefined
        }
      />
    );
  };

  /** A timeline's items, each isolated so one failing renderer leaves the rest. */
  function timeline(segments: readonly Segment[]): ReactNode[] {
    return segments.map((segment) => {
      if (segment.kind === "explored") {
        const key = `${message.id}-explored-${segment.calls[0]?.index}`;
        return (
          <ErrorBoundary key={key} fallback={renderFailure} resetKey={segment.calls}>
            <ExploredGroup calls={segment.calls} streaming={streaming} />
          </ErrorBoundary>
        );
      }
      const context: PartContext = {
        active: streaming && segment.index === lastIndex,
        citations: turn.citations,
        renderToolCall,
      };
      return (
        <ErrorBoundary
          key={`${message.id}-${segment.index}`}
          fallback={renderFailure}
          resetKey={segment.part}
        >
          {renderPart(segment.part, context)}
        </ErrorBoundary>
      );
    });
  }

  if (!turn.segments.length && !turn.citations.length) return null;
  const meta = streaming ? undefined : turnMeta(message.metadata);
  return (
    <div className="assistant-turn">
      {timeline(turn.segments)}
      {turn.citations.length ? <CitationList citations={turn.citations} /> : null}
      {meta ? <div className="turn-meta">{meta}</div> : null}
    </div>
  );
});

function renderFailure(error: Error): ReactNode {
  return (
    <div className="text-block timeline-item render-error" role="alert">
      无法显示这一项：{error.message}
    </div>
  );
}

/** "claude-opus-5 · 1.2k in · 340 out", once a turn is over. */
export function turnMeta(metadata: SessionMessage["metadata"]): string | undefined {
  if (!metadata) return undefined;
  const tokens = (count: number) =>
    count >= 1000 ? `${(count / 1000).toFixed(count >= 10_000 ? 0 : 1)}k` : String(count);
  const parts = [
    metadata.model,
    metadata.usage ? `${tokens(metadata.usage.inputTokens)} in` : undefined,
    metadata.usage ? `${tokens(metadata.usage.outputTokens)} out` : undefined,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : undefined;
}
