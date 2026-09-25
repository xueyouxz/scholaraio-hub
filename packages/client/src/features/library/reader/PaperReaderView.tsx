import type { LibraryPaperDetail, ReadingPosition } from "@scholaraio-hub/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { MessageSquare, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { libraryApi, newSessionUrl } from "../../../core/library";
import { toPaperSummary } from "../paperSummary";
import { LayerReader } from "./LayerReader";
import { PaperMarkdown } from "./PaperMarkdown";
import { PdfViewer } from "./PdfViewer";

interface PaperReaderViewProps {
  paperId: string | undefined;
  onClose?: () => void;
  leading?: React.ReactNode;
}
export function PaperReaderView({ paperId, onClose, leading }: PaperReaderViewProps) {
  const paper = useQuery({
    queryKey: ["library", "paper", paperId],
    queryFn: ({ signal }) => libraryApi.detail(paperId ?? "", signal),
    enabled: !!paperId,
  });
  const position = useQuery({
    queryKey: ["library", "position", paperId],
    queryFn: ({ signal }) => libraryApi.position(paperId ?? "", signal),
    enabled: !!paperId,
  });
  if (paper.error || position.error)
    return (
      <p role="alert" className="p-6 text-error">
        {(paper.error ?? position.error)?.message}
      </p>
    );
  if (!paper.data || !position.data) return <output className="p-6">正在加载文献…</output>;
  return (
    <Reader
      key={paper.data.id}
      paper={paper.data}
      saved={position.data}
      leading={leading}
      onClose={onClose}
    />
  );
}

function Reader({
  paper,
  saved,
  leading,
  onClose,
}: {
  paper: LibraryPaperDetail;
  saved: ReadingPosition;
  leading?: React.ReactNode;
  onClose?: () => void;
}) {
  const [params, setParams] = useSearchParams();
  const targetLine = Number(params.get("line") ?? saved.line);
  const mode =
    params.get("mode") === "overview"
      ? "overview"
      : params.get("mode") === "markdown" || !paper.hasPdf
        ? "markdown"
        : params.get("mode") === "pdf"
          ? "pdf"
          : saved.mode;
  const setMode = (value: "overview" | "pdf" | "markdown") => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set("mode", value);
      return next;
    });
  };
  const [line, setLine] = useState(targetLine);
  const [page, setPage] = useState(saved.page);

  const save = useMutation({
    mutationFn: (value: ReadingPosition) => libraryApi.savePosition(paper.id, value),
  });
  const saveRef = useRef(save.mutate);
  saveRef.current = save.mutate;
  const viewport = useRef<HTMLDivElement>(null);
  const pendingSave = useRef<ReadingPosition | null>(null);
  useEffect(() => {
    if (mode === "overview") return;
    pendingSave.current = { page, line, mode: mode === "pdf" ? "pdf" : "markdown" };
    const timer = setTimeout(() => {
      if (pendingSave.current) saveRef.current(pendingSave.current);
      pendingSave.current = null;
    }, 600);
    return () => clearTimeout(timer);
  }, [page, line, mode]);
  useEffect(
    () => () => {
      if (pendingSave.current) saveRef.current(pendingSave.current);
    },
    [],
  );
  useEffect(() => {
    const root = viewport.current;
    if (mode !== "markdown" || !root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        const first = visible[0];
        if (first) setLine(Number(first.target.getAttribute("data-line")));
      },
      { root, rootMargin: "0px 0px -70% 0px", threshold: 0 },
    );
    for (const section of root.querySelectorAll("[data-line]")) observer.observe(section);
    return () => observer.disconnect();
  }, [mode]);
  useEffect(() => {
    if (mode !== "markdown") return;
    const elements = [...(viewport.current?.querySelectorAll<HTMLElement>("[data-line]") ?? [])];
    const target = elements.find(
      (element) =>
        Number(element.dataset.line) <= targetLine && Number(element.dataset.endLine) >= targetLine,
    );
    target?.scrollIntoView({ block: "start" });
  }, [mode, targetLine]);
  return (
    <div className="flex-1 min-w-0 min-h-0 flex flex-col">
      <div className="shrink-0 flex items-center gap-2 px-5 border-b border-outline-variant/15 bg-surface-container-low h-12 overflow-x-auto">
        {leading}
        {(
          [
            ["overview", "概览"],
            ["markdown", "全文"],
            ["pdf", "PDF"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={mode === id}
            disabled={id === "pdf" ? !paper.hasPdf : id === "markdown" ? !paper.hasMarkdown : false}
            onClick={() => setMode(id)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors disabled:opacity-30 ${mode === id ? "bg-primary text-on-primary border-primary" : "bg-surface-container-high text-on-surface-variant border-outline-variant/30 hover:bg-surface-container"}`}
          >
            {label}
          </button>
        ))}
        <Link
          className="ml-auto shrink-0 p-1.5 rounded-full text-on-surface-variant hover:text-on-surface hover:bg-surface-container"
          aria-label="询问本文"
          title="询问本文"
          to={newSessionUrl(params.get("project") ?? undefined, [paper.id])}
        >
          <MessageSquare size={14} />
        </Link>
        {onClose ? (
          <button
            className="shrink-0 p-1.5 rounded-full text-on-surface-variant hover:bg-surface-container"
            type="button"
            aria-label="关闭阅读器"
            onClick={onClose}
          >
            <X size={14} />
          </button>
        ) : null}
      </div>
      {save.error ? (
        <p role="alert" className="text-error px-4">
          阅读位置保存失败：{save.error.message}
        </p>
      ) : null}
      {mode === "overview" ? (
        <LayerReader paper={toPaperSummary(paper)} conclusion={paper.l3Conclusion} />
      ) : mode === "pdf" ? (
        <>
          <PdfViewer
            url={`/api/library/papers/${encodeURIComponent(paper.id)}/pdf`}
            initialPage={saved.page}
            onPageChange={setPage}
          />
        </>
      ) : (
        <div ref={viewport} className="flex-1 min-h-0 overflow-y-auto px-8 py-6">
          {paper.hasMarkdown ? (
            <div className="max-w-3xl">
              <PaperMarkdown
                content={paper.markdown}
                paperId={paper.id}
                highlightedLine={params.has("line") ? targetLine : undefined}
              />
            </div>
          ) : (
            <p className="text-on-surface-variant">
              {paper.error || "尚未提取全文，可以先阅读 PDF。"}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
