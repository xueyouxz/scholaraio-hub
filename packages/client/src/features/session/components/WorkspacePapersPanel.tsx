import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { scholar } from "../../../core/api";
import { queryKeys } from "../../../core/queryKeys";

interface WorkspacePaperRowProps {
  id: string;
  title: string;
  authors: string;
  year: number;
  selected: boolean;
  onClick: () => void;
}

function WorkspacePaperRow({ title, authors, year, selected, onClick }: WorkspacePaperRowProps) {
  const firstAuthor = authors.split(/[,;]/)[0]?.trim() ?? "";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-3 py-2 rounded transition-colors cursor-pointer ${
        selected ? "bg-primary/10 text-on-surface" : "text-on-surface hover:bg-surface-container"
      }`}
    >
      <div className="text-xs font-medium leading-snug line-clamp-2">{title}</div>
      <div className="mt-1 text-[10px] font-mono text-on-surface-variant truncate">
        {firstAuthor}
        {year ? ` · ${year}` : ""}
      </div>
    </button>
  );
}

interface WorkspacePapersPanelProps {
  workspaceName: string;
  selectedPaperId: string | null;
  onSelectPaper: (paperId: string | null) => void;
  onClose: () => void;
}

export function WorkspacePapersPanel({
  workspaceName,
  selectedPaperId,
  onSelectPaper,
  onClose,
}: WorkspacePapersPanelProps) {
  const query = useQuery({
    queryKey: queryKeys.scholar.workspace(workspaceName),
    queryFn: ({ signal }) => scholar.getWorkspace(workspaceName, { signal }),
    select: (data) => data.workspace,
    staleTime: 30_000,
  });

  const papers = query.data?.papers ?? [];
  const errorMessage =
    query.error instanceof Error
      ? query.error.message
      : query.error
        ? "加载失败，请确认 scholaraio serve 已启动"
        : null;

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between px-3 py-2 border-b border-outline-variant/10 shrink-0">
        <span
          className="text-xs font-medium text-on-surface-variant uppercase tracking-wide truncate"
          title={workspaceName}
        >
          {workspaceName}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-on-surface-variant hover:text-on-surface transition-colors"
          title="Close"
        >
          <X size={13} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto min-h-0 py-1 px-1">
        {query.isLoading ? (
          <div className="px-3 py-4 text-xs text-on-surface-variant animate-pulse">加载中…</div>
        ) : errorMessage ? (
          <div className="px-3 py-4 text-xs text-error">
            {errorMessage}
            <button
              type="button"
              onClick={() => void query.refetch()}
              className="mt-2 block text-[10px] font-mono underline hover:text-on-surface"
            >
              重试
            </button>
          </div>
        ) : papers.length === 0 ? (
          <div className="px-3 py-4 text-xs text-on-surface-variant italic">该工作空间暂无论文</div>
        ) : (
          papers.map((paper) => (
            <WorkspacePaperRow
              key={paper.id}
              id={paper.id}
              title={paper.title}
              authors={paper.authors}
              year={paper.year}
              selected={selectedPaperId === paper.id}
              onClick={() => onSelectPaper(selectedPaperId === paper.id ? null : paper.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

const SIDEBAR_WIDTH_KEY = "workspace-papers-panel-width";
const DEFAULT_WIDTH = 320;
const MIN_WIDTH = 220;
const MAX_WIDTH_VW = 0.5;

interface ResizableProps {
  open: boolean;
  workspaceName: string;
  selectedPaperId: string | null;
  onSelectPaper: (paperId: string | null) => void;
  onClose: () => void;
}

export function ResizableWorkspacePapersPanel({
  open,
  workspaceName,
  selectedPaperId,
  onSelectPaper,
  onClose,
}: ResizableProps) {
  const [width, setWidth] = useState(() => {
    const stored = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    return stored ? Math.max(MIN_WIDTH, Number(stored)) : DEFAULT_WIDTH;
  });
  const dragging = useRef(false);
  const [isDragging, setIsDragging] = useState(false);
  const startX = useRef(0);
  const startWidth = useRef(0);
  // Lazy mount inner panel on first open so we don't pay query/effect cost
  // before the user ever opens it; keep it mounted afterwards so reopening
  // is instant (no flicker, cached data preserved).
  const [hasOpened, setHasOpened] = useState(open);
  useEffect(() => {
    if (open) setHasOpened(true);
  }, [open]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const delta = startX.current - e.clientX;
      const maxWidth = window.innerWidth * MAX_WIDTH_VW;
      const next = Math.min(maxWidth, Math.max(MIN_WIDTH, startWidth.current + delta));
      setWidth(next);
    };
    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      setIsDragging(false);
      setWidth((w) => {
        localStorage.setItem(SIDEBAR_WIDTH_KEY, String(w));
        return w;
      });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const onDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    setIsDragging(true);
    startX.current = e.clientX;
    startWidth.current = width;
  };

  return (
    <div
      className={`flex h-full shrink-0 justify-end overflow-hidden ${isDragging ? "" : "transition-[width] duration-200 ease-out"}`}
      style={{ width: open ? width : 0 }}
      aria-hidden={!open}
    >
      <div className="flex h-full shrink-0" style={{ width }}>
        <div
          className="w-1 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 shrink-0 transition-colors"
          onMouseDown={onDragStart}
        />
        <div className="flex-1 border-l border-outline-variant/10 bg-surface flex flex-col min-h-0 overflow-hidden">
          {hasOpened ? (
            <WorkspacePapersPanel
              workspaceName={workspaceName}
              selectedPaperId={selectedPaperId}
              onSelectPaper={onSelectPaper}
              onClose={onClose}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
