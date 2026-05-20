import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, ChevronDown, ChevronUp, FolderPlus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { scholar } from "../../../core/api";
import { queryKeys } from "../../../core/queryKeys";
import { StatusBadge } from "../../../shared/ui/StatusBadge";
import type { PaperReference } from "../types";

interface Props {
  paper: PaperReference | null;
  onClose: () => void;
}

export function PaperDetailPanel({ paper, onClose }: Props) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [abstractOpen, setAbstractOpen] = useState(false);
  const [wsOpen, setWsOpen] = useState(false);
  const [addedTo, setAddedTo] = useState<Set<string>>(new Set());
  const wsRef = useRef<HTMLDivElement>(null);

  const workspacesQuery = useQuery({
    queryKey: queryKeys.scholar.workspaces(),
    queryFn: ({ signal }) => scholar.getWorkspaces({ signal }),
    enabled: !!paper,
    select: (res) =>
      res.workspaces.map((workspace) => ({ id: workspace.id, name: workspace.name })),
  });

  const addPaperMutation = useMutation({
    mutationFn: ({ workspaceName, paperId }: { workspaceName: string; paperId: string }) =>
      scholar.addPaperToWorkspace(workspaceName, paperId),
    onSuccess: (_res, variables) => {
      setAddedTo((prev) => new Set([...prev, variables.workspaceName]));
      queryClient.invalidateQueries({ queryKey: queryKeys.scholar.workspaces() });
      queryClient.invalidateQueries({
        queryKey: queryKeys.scholar.workspace(variables.workspaceName),
      });
    },
  });

  const workspaces = workspacesQuery.data ?? [];
  const addingTo = addPaperMutation.isPending
    ? (addPaperMutation.variables?.workspaceName ?? null)
    : null;

  useEffect(() => {
    if (paper === undefined) return;
    setAbstractOpen(false);
    setWsOpen(false);
    setAddedTo(new Set());
  }, [paper]);

  useEffect(() => {
    if (!wsOpen) return;
    const handler = (e: MouseEvent) => {
      if (wsRef.current && !wsRef.current.contains(e.target as Node)) setWsOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [wsOpen]);

  const handleAdd = (wsName: string) => {
    if (!paper || addingTo) return;
    setWsOpen(false);
    addPaperMutation.mutate({ workspaceName: wsName, paperId: paper.id });
  };

  return (
    <div
      className={`fixed right-0 top-[3.25rem] bottom-0 w-[380px] z-20 flex flex-col bg-surface-container-lowest border-l border-outline-variant/20 shadow-2xl transition-all duration-[220ms] ease-in-out ${
        paper ? "translate-x-0 opacity-100" : "translate-x-full opacity-0 pointer-events-none"
      }`}
    >
      {paper ? (
        <>
          {/* Header */}
          <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-4 border-b border-outline-variant/10 shrink-0">
            <h2 className="font-serif text-sm font-bold text-on-surface leading-snug flex-1">
              {paper.title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-full text-on-surface-variant hover:bg-surface-container shrink-0 mt-0.5 border-0 bg-transparent cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto no-scrollbar px-5 py-4 space-y-5">
            {/* Authors */}
            <div>
              <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-on-surface-variant/60 mb-1.5">
                Authors
              </p>
              <p className="text-xs text-on-surface leading-relaxed">{paper.authors || "—"}</p>
            </div>

            {/* Metadata grid */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-on-surface-variant/60 mb-1">
                  来源
                </p>
                <p className="text-xs text-on-surface truncate" title={paper.source}>
                  {paper.source || "—"}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-on-surface-variant/60 mb-1">
                  年份
                </p>
                <p className="text-xs text-on-surface">{paper.year || "—"}</p>
              </div>
              <div>
                <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-on-surface-variant/60 mb-1">
                  引用量
                </p>
                <p className="text-xs text-on-surface">{paper.citations || "—"}</p>
              </div>
            </div>

            {/* Status */}
            <div>
              <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-on-surface-variant/60 mb-2">
                状态
              </p>
              <div className="flex flex-wrap gap-2">
                <StatusBadge status={paper.status} />
                {paper.hasPdf ? (
                  <span className="text-[10px] font-mono font-bold text-secondary bg-secondary-container/30 px-2 py-0.5 rounded leading-none uppercase">
                    PDF
                  </span>
                ) : null}
                {paper.isIndexed ? (
                  <span className="text-[10px] font-mono font-bold text-primary bg-primary-container/10 px-2 py-0.5 rounded leading-none uppercase">
                    Indexed
                  </span>
                ) : null}
              </div>
            </div>

            {/* Abstract — collapsed by default */}
            {paper.abstract ? (
              <div>
                <button
                  type="button"
                  onClick={() => setAbstractOpen((v) => !v)}
                  className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.2em] text-on-surface-variant/60 hover:text-on-surface-variant transition-colors border-0 bg-transparent p-0 cursor-pointer"
                >
                  摘要
                  {abstractOpen ? (
                    <ChevronUp className="w-3 h-3" />
                  ) : (
                    <ChevronDown className="w-3 h-3" />
                  )}
                </button>
                {abstractOpen ? (
                  <p className="mt-2 text-xs text-on-surface leading-relaxed">{paper.abstract}</p>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* Footer actions */}
          <div className="shrink-0 px-5 pb-5 pt-4 border-t border-outline-variant/10 space-y-2.5">
            {paper.hasPdf ? (
              <button
                type="button"
                onClick={() => navigate(`/library/${paper.id}`)}
                className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-surface-container text-on-surface text-xs font-semibold hover:bg-surface-container-high transition-colors border-0 cursor-pointer"
              >
                <BookOpen className="w-3.5 h-3.5" />
                阅读 PDF
              </button>
            ) : null}

            <div className="relative" ref={wsRef}>
              <button
                type="button"
                onClick={() => setWsOpen((v) => !v)}
                disabled={!!addingTo}
                className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl signature-gradient text-on-primary text-xs font-semibold disabled:opacity-50 border-0 cursor-pointer"
              >
                <FolderPlus className="w-3.5 h-3.5" />
                {addingTo ? `添加到 ${addingTo}…` : "添加到 Workspace"}
              </button>
              {wsOpen ? (
                <div className="absolute bottom-full mb-2 left-0 right-0 bg-surface-container-highest border border-outline-variant/20 rounded-xl p-1.5 shadow-xl z-50 max-h-44 overflow-y-auto no-scrollbar">
                  {workspaces.length === 0 ? (
                    <p className="text-xs text-on-surface-variant px-3 py-2">暂无工作区</p>
                  ) : (
                    workspaces.map((ws) => (
                      <button
                        key={ws.id}
                        type="button"
                        onClick={() => handleAdd(ws.name)}
                        className="w-full text-left px-3 py-2 text-xs rounded-lg text-on-surface hover:bg-surface-container transition-colors flex items-center justify-between border-0 bg-transparent cursor-pointer"
                      >
                        {ws.name}
                        {addedTo.has(ws.name) ? (
                          <span className="text-[10px] font-mono text-primary font-bold">
                            已添加
                          </span>
                        ) : null}
                      </button>
                    ))
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
