import { type ReactNode, memo, useState } from "react";
import type { ActivityItem, IndexedPart } from "../../lib/activity";
import type { PartOf, ToolPart } from "../../lib/parts";
import { ImageStrip } from "../parts/ImagePart";
import { Chevron, Spinner, describeToolCall, toolView } from "./ToolCallRow";
import { summarizeActivity } from "./activitySummary";
import { DiffStatsLabel } from "./blocks";

/**
 * The work between two texts as one row: "Ran 3 commands, edited app.ts +12 −3".
 * Expanding lists each call (and any reasoning) as its own row. Images the
 * calls returned stay visible underneath while the row is folded.
 */
export const ActivityGroup = memo(function ActivityGroup({
  items,
  tools,
  images,
  streaming,
  holdsPendingInput,
  renderItem,
}: {
  items: ActivityItem[];
  tools: ToolPart[];
  images: IndexedPart<PartOf<"file">>[];
  streaming: boolean;
  /** A decision waits on one of the calls: keep the run open so it can be answered. */
  holdsPendingInput: boolean;
  renderItem(item: ActivityItem): ReactNode;
}) {
  const [toggled, setToggled] = useState<boolean | undefined>();
  const expanded = toggled ?? holdsPendingInput;
  const views = tools.map((part) => toolView(part, streaming));
  const summary = summarizeActivity(views);
  const running = views.some((view) => view.status === "pending");
  const failed = views.filter((view) => view.status === "error").length;
  const pendingAt = views.map((view) => view.status).lastIndexOf("pending");
  const latest = pendingAt >= 0 ? tools[pendingAt] : undefined;

  return (
    <div className={`tool-row activity-group timeline-item${expanded ? " expanded" : ""}`}>
      <button
        type="button"
        className="tool-row-header"
        aria-expanded={expanded}
        onClick={() => setToggled(!expanded)}
      >
        {running ? (
          <span className="tool-spinner" aria-label="Running">
            <Spinner />
          </span>
        ) : null}
        <span className="activity-summary">{summary.text}</span>
        {summary.stats ? <DiffStatsLabel {...summary.stats} /> : null}
        {failed ? <span className="tool-outcome text-error">{failed} failed</span> : null}
        {latest && !expanded ? (
          <span className="tool-outcome activity-latest">
            {describeToolCall(latest, streaming)}
          </span>
        ) : null}
        <Chevron open={expanded} />
      </button>
      {expanded ? (
        <div className="activity-group-body">{items.map((item) => renderItem(item))}</div>
      ) : null}
      {images.length ? <ImageStrip images={images} /> : null}
    </div>
  );
});
