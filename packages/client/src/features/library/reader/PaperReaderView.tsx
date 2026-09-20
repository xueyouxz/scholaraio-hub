import type { LibraryPaperDetail, ReadingPosition } from "@scholaraio-hub/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { libraryApi } from "../../../core/library";
import { Markdown } from "../../../shared/components/Markdown";
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
  const [mode, setMode] = useState(
    params.get("mode") === "markdown" || !paper.hasPdf ? "markdown" : saved.mode,
  );
  const [line, setLine] = useState(targetLine);
  const [page, setPage] = useState(saved.page);
  const [jumpPage, setJumpPage] = useState(saved.page);
  const [pageInput, setPageInput] = useState(String(saved.page));
  const save = useMutation({
    mutationFn: (value: ReadingPosition) => libraryApi.savePosition(paper.id, value),
  });
  const saveRef = useRef(save.mutate);
  saveRef.current = save.mutate;
  const viewport = useRef<HTMLDivElement>(null);
  const pendingSave = useRef<ReadingPosition | null>(null);
  useEffect(() => {
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
    const chunk = paper.chunks.find(
      (chunk) => chunk.start_line <= targetLine && chunk.end_line >= targetLine,
    );
    if (chunk)
      viewport.current
        ?.querySelector(`[id="line-${chunk.start_line}"]`)
        ?.scrollIntoView({ block: "start" });
  }, [mode, targetLine, paper.chunks]);
  return (
    <div className="flex-1 min-w-0 min-h-0 flex flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-outline-variant/15 p-3">
        {leading}
        <h1 className="text-base text-primary truncate flex-1 min-w-40">{paper.title}</h1>
        <button
          type="button"
          className="hub-button"
          aria-pressed={mode === "pdf"}
          disabled={!paper.hasPdf}
          onClick={() => setMode("pdf")}
        >
          PDF
        </button>
        <button
          type="button"
          className="hub-button"
          aria-pressed={mode === "markdown"}
          disabled={!paper.hasMarkdown}
          onClick={() => setMode("markdown")}
        >
          全文
        </button>
        <Link className="hub-button" to={`/sessions?papers=${encodeURIComponent(paper.id)}`}>
          询问本文
        </Link>
        {onClose ? (
          <button className="hub-button" type="button" aria-label="关闭阅读器" onClick={onClose}>
            关闭
          </button>
        ) : null}
      </div>
      {save.error ? (
        <p role="alert" className="text-error px-4">
          阅读位置保存失败：{save.error.message}
        </p>
      ) : null}
      {mode === "pdf" ? (
        <>
          <form
            className="flex items-center gap-2 px-4 py-2 text-xs"
            onSubmit={(event) => {
              event.preventDefault();
              setJumpPage(Math.max(1, Number(pageInput) || 1));
            }}
          >
            <label htmlFor="reader-page">跳转页码</label>
            <input
              id="reader-page"
              className="hub-input w-20"
              type="number"
              min="1"
              value={pageInput}
              onChange={(event) => setPageInput(event.target.value)}
            />
            <button className="hub-button" type="submit">
              跳转
            </button>
            <span>当前第 {page} 页</span>
          </form>
          <PdfViewer
            url={`/api/library/papers/${encodeURIComponent(paper.id)}/pdf`}
            initialPage={jumpPage}
            onPageChange={setPage}
          />
        </>
      ) : (
        <div ref={viewport} className="flex-1 overflow-auto p-6 lg:px-12">
          {paper.hasMarkdown ? (
            paper.chunks.map((chunk) => (
              <section
                key={chunk.chunk_id}
                id={`line-${chunk.start_line}`}
                data-line={chunk.start_line}
                className={`max-w-4xl mx-auto py-3 scroll-mt-4 ${params.has("line") && chunk.start_line <= targetLine && chunk.end_line >= targetLine ? "bg-secondary-container/30 rounded-xl px-4" : ""}`}
              >
                <button
                  type="button"
                  className="text-xs text-on-surface-variant mb-2 hover:text-primary"
                  onClick={() => {
                    setParams({ mode: "markdown", line: String(chunk.start_line) });
                  }}
                >
                  第 {chunk.start_line}–{chunk.end_line} 行
                </button>
                <Markdown
                  text={chunk.text}
                  imageBase={`/api/library/papers/${encodeURIComponent(paper.id)}/attachments/`}
                />
              </section>
            ))
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
