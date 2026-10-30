import type { LibraryPaperDetail, ReadingPosition } from "@scholaraio-hub/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { MessageSquare, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { libraryUrl } from "../../../core/http";
import { libraryApi } from "../../../core/library";
import { newSessionUrl } from "../../../core/sessions";
import { ChipGroup } from "../../../shared/ui/ChipGroup";
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
        <ChipGroup
          label="阅读方式"
          value={mode}
          onChange={setMode}
          chips={[
            { value: "overview", label: "概览" },
            { value: "markdown", label: "全文", disabled: !paper.hasMarkdown },
            { value: "pdf", label: "PDF", disabled: !paper.hasPdf },
          ]}
        />
        <Link
          className="btn-ghost ml-auto shrink-0 p-1.5 hover:text-on-surface"
          aria-label="询问本文"
          title="询问本文"
          to={newSessionUrl({ references: [{ kind: "paper", id: paper.id }] })}
        >
          <MessageSquare size={14} />
        </Link>
        {onClose ? (
          <button
            className="btn-ghost shrink-0 p-1.5"
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
            url={libraryUrl(`/papers/${encodeURIComponent(paper.id)}/pdf`)}
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
