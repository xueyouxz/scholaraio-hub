import type { LibrarySearchResult } from "@scholaraio-hub/shared";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

export function PaperCollection({
  results,
  view,
  selected,
  onToggle,
  projectId,
}: {
  results: LibrarySearchResult[];
  view: "grid" | "list";
  selected: Set<string>;
  onToggle: (id: string) => void;
  projectId?: string;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const columns = view === "list" ? 1 : Math.max(1, Math.min(3, Math.floor(width / 290)));
  const height = view === "grid" ? 332 : 168;
  const virtualizer = useVirtualizer({
    count: Math.ceil(results.length / columns),
    getScrollElement: () => viewport.current,
    estimateSize: () => height,
    overscan: 3,
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: row geometry changes invalidate the virtualizer measurement cache.
  useEffect(() => {
    virtualizer.measure();
  }, [height, columns, virtualizer]);
  return (
    <div ref={viewport} className="flex-1 min-h-0 overflow-auto" aria-label="文献结果">
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((row) => (
          <div
            key={row.index}
            className="absolute top-0 left-0 w-full grid gap-4 pb-4"
            style={{
              transform: `translateY(${row.start}px)`,
              height,
              gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            }}
          >
            {results
              .slice(row.index * columns, (row.index + 1) * columns)
              .map(({ paper, matches }) => {
                const params = new URLSearchParams();
                if (projectId) params.set("project", projectId);
                if (matches[0]) {
                  params.set("line", String(matches[0].start_line));
                  params.set("mode", "markdown");
                } else params.set("mode", "overview");
                const target = `/library/${encodeURIComponent(paper.id)}?${params}`;
                return (
                  <article
                    key={paper.id}
                    className={`relative h-full rounded-xl border overflow-hidden transition-colors ${selected.has(paper.id) ? "bg-primary-container/20 border-primary/30 ring-1 ring-primary/20" : "bg-surface-container-low border-outline-variant/20 hover:border-outline-variant/30 hover:shadow-md"}`}
                  >
                    <input
                      type="checkbox"
                      className="absolute right-3 top-3 z-10 accent-primary w-4 h-4"
                      aria-label={`选择 ${paper.title}`}
                      checked={selected.has(paper.id)}
                      disabled={!selected.has(paper.id) && selected.size >= 100}
                      onChange={() => onToggle(paper.id)}
                    />
                    <div className="min-w-0 h-full flex flex-col">
                      <Link
                        to={target}
                        className={`font-serif text-base font-semibold text-on-surface hover:text-primary px-5 pt-5 pr-10 ${view === "grid" ? "line-clamp-2" : "line-clamp-1"}`}
                      >
                        {paper.title}
                      </Link>
                      <p className="text-sm text-on-surface font-medium line-clamp-1 px-5 mt-2">
                        {paper.authors || "作者信息暂无"}
                      </p>
                      <p className="text-[11px] font-mono text-on-surface-variant/60 tracking-wide px-5 mt-1.5 truncate">
                        {paper.journal || "来源暂无"} · {paper.year || "年份暂无"}
                      </p>
                      {view === "grid" && paper.coverImage ? (
                        <Link to={target} className="block h-36 mt-auto overflow-hidden">
                          <img
                            src={`/api/library/papers/${encodeURIComponent(paper.id)}/attachments/${paper.coverImage.split("/").map(encodeURIComponent).join("/")}`}
                            width={400}
                            height={144}
                            alt=""
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                        </Link>
                      ) : (
                        <div className="flex-1" />
                      )}
                      <div className="flex justify-between gap-2 text-[10px] font-mono px-5 py-2 text-on-surface-variant">
                        <span>
                          {paper.hasPdf ? "PDF" : "无 PDF"} ·{" "}
                          {paper.hasMarkdown ? "已解析" : "未解析"}
                        </span>
                        <Link className="text-primary hover:underline" to={target}>
                          阅读 →
                        </Link>
                      </div>
                    </div>
                  </article>
                );
              })}
          </div>
        ))}
      </div>
    </div>
  );
}
