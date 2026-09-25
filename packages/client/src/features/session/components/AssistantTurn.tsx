import { type InputRequest, type SessionMessage, parentCallIdOf } from "@scholaraio-hub/shared";
import { type ReactNode, memo, useMemo } from "react";
import { ErrorBoundary } from "../../../shared/ui/ErrorBoundary";
import type { ActivityItem, Segment } from "../lib/activity";
import type { Part, ToolPart } from "../lib/parts";
import { buildTurnTree } from "../lib/turnTree";
import { CopyButton } from "./CopyButton";
import { FileChangesCard } from "./FileChangesCard";
import { InputRequestPrompt } from "./InputRequestPrompt";
import { CitationList, type PartContext, renderPart } from "./parts/registry";
import { ActivityGroup } from "./renderers/ActivityGroup";
import { ToolCallRow, describeToolCall, toolView } from "./renderers/ToolCallRow";
import { fileChanges } from "./renderers/registry";

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
            <InputRequestPrompt
              key={pendingInput.id}
              request={pendingInput}
              sessionId={sessionId}
              placement="inline"
              onDone={onInputDone ?? (() => {})}
            />
          ) : undefined
        }
      />
    );
  };

  /** One part, isolated so a renderer that throws leaves the rest of the turn. */
  const item = (part: Part, index: number): ReactNode => (
    <ErrorBoundary key={`${message.id}-${index}`} fallback={renderFailure} resetKey={part}>
      {renderPart(part, {
        active: streaming && index === lastIndex,
        citations: turn.citations,
        renderToolCall,
      } satisfies PartContext)}
    </ErrorBoundary>
  );
  const renderActivityItem = ({ part, index }: ActivityItem) => item(part, index);

  function timeline(segments: readonly Segment[]): ReactNode[] {
    return segments.map((segment) => {
      if (segment.kind === "part") return item(segment.part, segment.index);
      const first = segment.items[0]?.index;
      return (
        <ErrorBoundary
          key={`${message.id}-activity-${first}`}
          fallback={renderFailure}
          resetKey={segment.items}
        >
          <ActivityGroup
            items={segment.items}
            tools={segment.tools}
            images={segment.images}
            streaming={streaming}
            holdsPendingInput={
              !!pendingInput &&
              segment.tools.some((tool) => tool.toolCallId === pendingInput.toolCallId)
            }
            renderItem={renderActivityItem}
          />
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
      {streaming ? null : <TurnChanges parts={message.parts} />}
      {streaming ? null : (
        <div className="turn-footer">
          <CopyButton text={answerText(message.parts)} label="复制回答" />
          {meta ? <span className="turn-meta">{meta}</span> : null}
        </div>
      )}
    </div>
  );
});

/** Every file the finished turn changed, main agent and subagents alike. */
function TurnChanges({ parts }: { parts: readonly Part[] }) {
  const changes = useMemo(
    () =>
      parts.flatMap((part) =>
        part.type === "dynamic-tool" ? fileChanges(toolView(part, false)) : [],
      ),
    [parts],
  );
  return changes.length ? <FileChangesCard changes={changes} /> : null;
}

/** The answer as the user reads it: the main agent's text, without tool output. */
function answerText(parts: readonly Part[]): string {
  return parts
    .flatMap((part) => (part.type === "text" && !parentCallIdOf(part) ? [part.text.trim()] : []))
    .filter(Boolean)
    .join("\n\n");
}

function renderFailure(error: Error): ReactNode {
  return (
    <div className="text-block timeline-item render-error" role="alert">
      无法显示这一项：{error.message}
    </div>
  );
}

/** "claude-opus-5 · 1m 12s · 1.2k in · 340 out", once a turn is over. */
export function turnMeta(metadata: SessionMessage["metadata"]): string | undefined {
  if (!metadata) return undefined;
  const tokens = (count: number) =>
    count >= 1000 ? `${(count / 1000).toFixed(count >= 10_000 ? 0 : 1)}k` : String(count);
  const parts = [
    metadata.model,
    metadata.durationMs !== undefined ? formatDuration(metadata.durationMs) : undefined,
    metadata.usage ? `${tokens(metadata.usage.inputTokens)} in` : undefined,
    metadata.usage ? `${tokens(metadata.usage.outputTokens)} out` : undefined,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : undefined;
}

/** "850ms", "12s", "1m 12s", "1h 3m". */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
