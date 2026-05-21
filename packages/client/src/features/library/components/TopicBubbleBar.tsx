import { Layers } from "lucide-react";
import { useState } from "react";
import type { ScholarTopic } from "../../../core/api";
import type { TopicColorMap } from "../types";

interface LassoData {
  ratio: number;
  count: number;
}

interface Props {
  built: boolean;
  topics: ScholarTopic[];
  topicColors: TopicColorMap;
  activeTopicId: number | null;
  lassoFills?: Map<number, LassoData> | null;
  onTopicClick: (id: number | null) => void;
  onBuildRequest?: () => void;
}

const MIN_R = 6;
const MAX_R = 20;

export function TopicBubbleBar({
  built,
  topics,
  topicColors,
  activeTopicId,
  lassoFills,
  onTopicClick,
  onBuildRequest,
}: Props) {
  const [tooltip, setTooltip] = useState<{ id: number; x: number; y: number } | null>(null);

  if (!built) {
    return (
      <div
        className="shrink-0 bg-surface-container-low border border-outline-variant/10 rounded-xl flex items-center justify-center gap-3 px-6"
        style={{ height: 70 }}
      >
        <Layers className="w-4 h-4 text-on-surface-variant" />
        <span className="text-xs text-on-surface-variant font-mono">主题模型尚未构建</span>
        {onBuildRequest && (
          <button
            type="button"
            onClick={onBuildRequest}
            className="px-3 py-1 bg-primary/10 hover:bg-primary/20 text-primary text-xs font-mono font-bold rounded-lg transition-colors"
          >
            构建
          </button>
        )}
      </div>
    );
  }

  const maxCount = Math.max(...topics.map((t) => t.paperCount), 1);

  const getRadius = (count: number) => MIN_R + (count / maxCount) * (MAX_R - MIN_R);

  const hoveredTopic = tooltip ? topics.find((t) => t.id === tooltip.id) : null;

  return (
    <>
      <div
        className="shrink-0 bg-surface-container-low border border-outline-variant/10 rounded-xl overflow-x-auto no-scrollbar"
        style={{ height: 70 }}
      >
        <div
          className="flex items-center justify-center gap-3.5 px-4 min-w-full"
          style={{ height: 70 }}
        >
          {activeTopicId !== null && (
            <div className="flex flex-col items-center shrink-0" style={{ height: 56 }}>
              <div style={{ height: MAX_R * 2, display: "flex", alignItems: "center" }}>
                <button
                  type="button"
                  onClick={() => onTopicClick(null)}
                  className="text-[10px] font-mono text-on-surface-variant hover:text-primary transition-colors"
                >
                  清除
                </button>
              </div>
              <div style={{ height: 16 }} />
            </div>
          )}
          {topics.map((topic) => {
            const r = getRadius(topic.paperCount);
            const color = topicColors.get(topic.id) ?? "#22c55e";
            const isActive = activeTopicId === topic.id;
            const isHovered = tooltip?.id === topic.id;
            const isDimmed = activeTopicId !== null && !isActive;

            const lassoData = lassoFills ? (lassoFills.get(topic.id) ?? null) : null;
            const hasLasso = lassoFills !== null && lassoFills !== undefined;
            const isGrayed = hasLasso && lassoData === null;

            return (
              // Fixed-height wrapper: MAX_R*2 circle zone + 16px label zone = 56px
              // items-center on the row aligns all wrappers by their mid-point → circle centers align
              <div
                key={topic.id}
                className="flex flex-col items-center shrink-0"
                style={{ height: MAX_R * 2 + 16 }}
              >
                {/* Circle zone — fixed height MAX_R*2, circle centered inside */}
                <div
                  style={{
                    height: MAX_R * 2,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => onTopicClick(isActive ? null : topic.id)}
                    onMouseEnter={(e) => {
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      setTooltip({
                        id: topic.id,
                        x: rect.left + rect.width / 2,
                        y: rect.bottom + 6,
                      });
                    }}
                    onMouseLeave={() => setTooltip(null)}
                    className="transition-transform duration-150 hover:scale-110"
                    style={{
                      width: r * 2,
                      height: r * 2,
                      position: "relative",
                      overflow: "hidden",
                      borderRadius: "50%",
                      opacity: isDimmed ? 0.25 : 1,
                      outline: isActive ? `2px solid ${color}` : "none",
                      outlineOffset: 2,
                      flexShrink: 0,
                    }}
                  >
                    <span
                      style={{
                        position: "absolute",
                        inset: 0,
                        backgroundColor: isGrayed ? "#bfc9c0" : color,
                        opacity: hasLasso ? 0.2 : isHovered ? 1 : 0.72,
                        transition: "background-color 0.2s, opacity 0.2s",
                      }}
                    />
                    {lassoData && (
                      <span
                        style={{
                          position: "absolute",
                          bottom: 0,
                          left: 0,
                          right: 0,
                          height: `${lassoData.ratio * 100}%`,
                          backgroundColor: color,
                          transition: "height 0.3s ease",
                        }}
                      />
                    )}
                  </button>
                </div>
                {/* Label zone — fixed 16px, invisible when no lasso to preserve layout */}
                <div
                  style={{
                    height: 16,
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "center",
                    paddingTop: 2,
                  }}
                >
                  <span
                    className="text-[9px] font-mono font-bold leading-none text-on-surface-variant"
                    style={{ visibility: lassoData ? "visible" : "hidden" }}
                  >
                    {lassoData?.count ?? 0}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {hoveredTopic && tooltip && (
        <div
          className="pointer-events-none fixed z-50 bg-surface-container-high border border-outline-variant/20 rounded-lg px-2 py-1 text-[11px] text-on-surface shadow-md"
          style={{
            left: tooltip.x,
            top: tooltip.y,
            transform: "translateX(-50%)",
            maxWidth: 260,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {hoveredTopic.keywords.slice(0, 5).join(", ")}
          <span className="ml-1.5 text-on-surface-variant font-mono">
            ·{hoveredTopic.paperCount}
          </span>
        </div>
      )}
    </>
  );
}
