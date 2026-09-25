import type { LibraryAnalytics, LibraryTopic } from "@scholaraio-hub/shared";
import { CheckSquare, Loader2, MessageSquare, X } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { newSessionUrl } from "../../../core/sessions";
import type { PaperSummary } from "../paperSummary";
import { SELECTION_CAP, useLibrarySelection } from "../selection";
import type { TopicColorMap } from "../utils/topicColors";
import { PaperDetailPanel } from "./PaperDetailPanel";
import { ScatterPlot, type ScatterPlotRef } from "./charts/ScatterPlot";

interface Props {
  papers: PaperSummary[];
  projection?: LibraryAnalytics["projection"];
  topics: LibraryTopic[];
  topicColors: TopicColorMap;
  loading: boolean;
  /** Heads the side column, above the topics: where the library's work stands. */
  status: ReactNode;
  /** Stands in for the map, and the topics beside it, when there is nothing to draw. */
  placeholder?: ReactNode;
}

/**
 * The library as a map, with its topics beside it, each pointing at the other.
 *
 * Picking a topic lights up its papers on the map; picking a paper on the map
 * marks its topic in the list. A lasso swaps the list for the papers inside it.
 */
export function LibraryAnalyticsPanel({
  papers,
  projection,
  topics,
  topicColors,
  loading,
  status,
  placeholder,
}: Props) {
  const plot = useRef<ScatterPlotRef>(null);
  const [selectedPaperId, setSelectedPaperId] = useState<string | null>(null);
  const [lassoed, setLassoed] = useState<Set<string> | null>(null);
  const [topic, setTopic] = useState<number | null>(null);
  const [preview, setPreview] = useState<number | null>(null);

  const points = projection?.points ?? [];
  const byId = useMemo(() => new Map(papers.map((paper) => [paper.id, paper])), [papers]);
  const topicOf = useMemo(
    () => new Map(points.map((point) => [point.id, point.topicId])),
    [points],
  );
  const members = useMemo(() => {
    const groups = new Map<number, Set<string>>();
    for (const point of points) {
      const group = groups.get(point.topicId) ?? new Set<string>();
      group.add(point.id);
      groups.set(point.topicId, group);
    }
    return groups;
  }, [points]);
  const shownTopic = preview ?? topic;
  const activeIds = shownTopic === null ? null : (members.get(shownTopic) ?? null);
  const selectedPaper = selectedPaperId ? (byId.get(selectedPaperId) ?? null) : null;
  const focusedTopic = selectedPaperId ? (topicOf.get(selectedPaperId) ?? null) : null;

  const chooseTopic = (id: number) => {
    setTopic((previous) => (previous === id ? null : id));
    if (lassoed) {
      setLassoed(null);
      plot.current?.clearLasso();
    }
  };

  return (
    <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_22rem] 2xl:grid-cols-[minmax(0,1fr)_26rem]">
      {/* The map takes all the room the topics leave, across and down. */}
      <div
        aria-label="文献主题分析"
        className="relative min-h-[28rem] w-full overflow-hidden rounded-lg border border-outline-variant/10 bg-surface-container-low"
      >
        {placeholder ? (
          <div className="absolute inset-0 flex items-center justify-center p-6">{placeholder}</div>
        ) : loading ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <div className="absolute inset-0 skeleton-shimmer opacity-40" aria-hidden="true" />
            <Loader2 className="relative w-5 h-5 animate-spin text-primary" aria-hidden="true" />
            <p className="relative text-xs text-on-surface-variant">正在绘制主题地图…</p>
          </div>
        ) : projection?.built ? (
          <ScatterPlot
            ref={plot}
            points={points}
            activeIds={activeIds}
            selectedId={selectedPaperId}
            topicColors={topicColors}
            onPointClick={(id) => setSelectedPaperId((prev) => (prev === id ? null : id))}
            onLassoSelect={(ids) => {
              setLassoed(ids);
              setTopic(null);
            }}
            onReset={() => {
              setLassoed(null);
              setTopic(null);
            }}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <p className="text-xs font-medium text-on-surface">散点图尚未生成</p>
            <p className="max-w-xs text-[11px] leading-relaxed text-on-surface-variant">
              当前文献库没有保存的投影数据。构建主题后会自动显示。
            </p>
          </div>
        )}
      </div>

      {/* The column takes the map's height rather than setting its own. */}
      <aside className="relative flex min-h-[20rem] flex-col lg:min-h-0">
        <div className="flex min-h-0 flex-1 flex-col gap-3 lg:absolute lg:inset-0">
          {status}
          {placeholder ? null : lassoed ? (
            <LassoList
              ids={lassoed}
              byId={byId}
              topicOf={topicOf}
              topicColors={topicColors}
              activeId={selectedPaperId}
              onOpen={(id) => setSelectedPaperId((prev) => (prev === id ? null : id))}
              onClear={() => {
                setLassoed(null);
                plot.current?.clearLasso();
              }}
            />
          ) : (
            <TopicList
              topics={topics}
              topicColors={topicColors}
              selected={topic}
              focused={focusedTopic}
              onChoose={chooseTopic}
              onPreview={setPreview}
            />
          )}
        </div>
      </aside>

      <PaperDetailPanel paper={selectedPaper} onClose={() => setSelectedPaperId(null)} />
    </div>
  );
}

/** Every topic, largest first; choosing one shows its papers on the map. */
function TopicList({
  topics,
  topicColors,
  selected,
  focused,
  onChoose,
  onPreview,
}: {
  topics: LibraryTopic[];
  topicColors: TopicColorMap;
  selected: number | null;
  /** The topic of the paper picked on the map. */
  focused: number | null;
  onChoose: (id: number) => void;
  onPreview: (id: number | null) => void;
}) {
  const sorted = useMemo(() => [...topics].sort((a, b) => b.paperCount - a.paperCount), [topics]);
  const largest = sorted[0]?.paperCount || 1;
  const rows = useRef(new Map<number, HTMLLIElement>());
  // A paper picked on the map brings its topic into view.
  useEffect(() => {
    if (focused === null) return;
    rows.current.get(focused)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focused]);
  return (
    <section
      aria-label="主题"
      className="flex min-h-0 flex-1 flex-col rounded-lg border border-outline-variant/10 bg-surface-container-low"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-outline-variant/10 px-3 py-2">
        <p className="text-[10px] font-mono font-bold uppercase tracking-widest text-on-surface-variant">
          主题 {topics.length}
        </p>
        <div className="flex-1" />
        {selected !== null ? (
          <button
            type="button"
            onClick={() => onChoose(selected)}
            className="text-[10px] font-mono font-bold text-primary hover:underline"
          >
            显示全部
          </button>
        ) : null}
      </div>
      <ul className="min-h-0 flex-1 overflow-auto p-1.5" onMouseLeave={() => onPreview(null)}>
        {sorted.map((item) => {
          const active = selected === item.id;
          const color = topicColors.get(item.id) ?? "#bfc9c0";
          return (
            <li
              key={item.id}
              ref={(element) => {
                if (element) rows.current.set(item.id, element);
                else rows.current.delete(item.id);
              }}
            >
              <button
                type="button"
                aria-pressed={active}
                onClick={() => onChoose(item.id)}
                onMouseEnter={() => onPreview(item.id)}
                onFocus={() => onPreview(item.id)}
                onBlur={() => onPreview(null)}
                title={item.keywords.join(", ")}
                className={`flex w-full flex-col gap-1 rounded-md px-2 py-1.5 text-left transition-colors ${
                  active
                    ? "bg-surface-container-high"
                    : focused === item.id
                      ? "bg-primary/5 ring-1 ring-primary/20"
                      : "hover:bg-surface-container"
                }`}
              >
                <span className="flex items-center gap-2 text-xs">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: color }}
                    aria-hidden="true"
                  />
                  <span
                    className={`min-w-0 flex-1 truncate ${active ? "font-semibold text-primary" : "text-on-surface"}`}
                  >
                    {item.name || item.keywords.slice(0, 3).join(" · ")}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] tabular-nums text-on-surface-variant">
                    {item.paperCount}
                  </span>
                </span>
                <span
                  className="ml-4 block h-0.5 overflow-hidden rounded-full bg-outline-variant/15"
                  aria-hidden="true"
                >
                  <span
                    className="block h-full rounded-full"
                    style={{
                      width: `${(item.paperCount / largest) * 100}%`,
                      backgroundColor: color,
                    }}
                  />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The papers inside the lasso, each one click from its detail. */
function LassoList({
  ids,
  byId,
  topicOf,
  topicColors,
  activeId,
  onOpen,
  onClear,
}: {
  ids: Set<string>;
  byId: Map<string, PaperSummary>;
  topicOf: Map<string, number>;
  topicColors: TopicColorMap;
  activeId: string | null;
  onOpen: (id: string) => void;
  onClear: () => void;
}) {
  const selection = useLibrarySelection();
  const papers = [...ids]
    .map((id) => byId.get(id))
    .filter((paper): paper is PaperSummary => Boolean(paper))
    .sort((a, b) => b.year - a.year);
  const askIds = papers.slice(0, 100).map((paper) => paper.id);
  return (
    <section
      aria-label="圈选的文献"
      className="flex min-h-0 flex-1 flex-col rounded-lg border border-outline-variant/10 bg-surface-container-low"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-outline-variant/10 px-3 py-2">
        <p className="text-[10px] font-mono font-bold uppercase tracking-widest text-on-surface-variant">
          已圈选 {papers.length} 篇
        </p>
        <div className="flex-1" />
        <button
          type="button"
          aria-label="清除圈选"
          onClick={onClear}
          className="rounded-full p-1 text-on-surface-variant hover:bg-surface-container-high"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      {papers.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-on-surface-variant">
          圈选区域内没有文献。
        </p>
      ) : (
        <ul className="min-h-0 flex-1 divide-y divide-outline-variant/10 overflow-auto">
          {papers.map((paper) => (
            <li key={paper.id}>
              <button
                type="button"
                aria-pressed={activeId === paper.id}
                onClick={() => onOpen(paper.id)}
                className={`flex w-full items-start gap-2 px-3 py-2 text-left transition-colors ${
                  activeId === paper.id ? "bg-surface-container-high" : "hover:bg-surface-container"
                }`}
              >
                <span
                  className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                  style={{
                    backgroundColor: topicColors.get(topicOf.get(paper.id) ?? -1) ?? "#bfc9c0",
                  }}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 text-xs font-medium text-on-surface">
                    {paper.title}
                  </span>
                  <span className="block truncate text-[10px] font-mono text-on-surface-variant/70">
                    {[paper.authors.split(/[,;，]/)[0], paper.year || null]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {papers.length ? (
        <div className="flex shrink-0 items-center gap-2 border-t border-outline-variant/10 px-3 py-2">
          <button
            type="button"
            onClick={() =>
              selection.selectMany(papers.slice(0, SELECTION_CAP).map((paper) => paper.id))
            }
            className="inline-flex items-center gap-1.5 rounded-full bg-surface-container-high px-3 py-1.5 text-xs font-medium text-on-surface active:scale-95"
            title="加入下方操作栏，可导出或加入 Workspace"
          >
            <CheckSquare className="w-3.5 h-3.5" aria-hidden="true" />
            选中这些
          </button>
          <Link
            to={newSessionUrl(undefined, askIds)}
            className="inline-flex items-center gap-1.5 rounded-full bg-surface-container-high px-3 py-1.5 text-xs font-medium text-on-surface active:scale-95"
          >
            <MessageSquare className="w-3.5 h-3.5" aria-hidden="true" />
            询问
          </Link>
        </div>
      ) : null}
    </section>
  );
}
