import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { libraryApi } from "../../../core/library";
import { ResizableSessionPanel } from "./ResizableSessionPanel";

interface WorkspacePaperRowProps {
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
  projectId: string;
  selectedPaperId: string | null;
  onSelectPaper: (paperId: string | null) => void;
  onClose: () => void;
}

export function WorkspacePapersPanel({
  projectId,
  selectedPaperId,
  onSelectPaper,
  onClose,
}: WorkspacePapersPanelProps) {
  const query = useQuery({
    queryKey: ["library", "project-papers", projectId],
    queryFn: async ({ signal }) => {
      const [project, library] = await Promise.all([
        libraryApi.project(projectId, signal),
        libraryApi.papers(signal),
      ]);
      const ids = new Set(project.paperIds);
      return { papers: library.papers.filter((paper) => ids.has(paper.id)) };
    },
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
          title={projectId}
        >
          {projectId}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-on-surface-variant hover:text-on-surface transition-colors"
          title="关闭项目文献"
          aria-label="关闭项目文献"
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
              title={paper.title}
              authors={paper.authors}
              year={Number(paper.year)}
              selected={selectedPaperId === paper.id}
              onClick={() => onSelectPaper(selectedPaperId === paper.id ? null : paper.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

export function ResizableWorkspacePapersPanel({
  open,
  projectId,
  selectedPaperId,
  onSelectPaper,
  onClose,
}: {
  open: boolean;
  projectId: string;
  selectedPaperId: string | null;
  onSelectPaper: (id: string | null) => void;
  onClose: () => void;
}) {
  return (
    <ResizableSessionPanel
      open={open}
      title="项目文献"
      storageKey="workspace-papers-panel-width"
      onClose={onClose}
    >
      <WorkspacePapersPanel
        projectId={projectId}
        selectedPaperId={selectedPaperId}
        onSelectPaper={onSelectPaper}
        onClose={onClose}
      />
    </ResizableSessionPanel>
  );
}
