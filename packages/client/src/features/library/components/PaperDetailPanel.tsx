import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, FolderPlus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { libraryApi } from "../../../core/library";
import { StatusBadge } from "../../../shared/ui/StatusBadge";
import { buildPaperImageUrl } from "../paperUtils";
import type { PaperReference } from "../types";

interface Props {
  paper: PaperReference | null;
  onClose: () => void;
}

export function PaperDetailPanel({ paper, onClose }: Props) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const queryClient = useQueryClient();
  const [wsOpen, setWsOpen] = useState(false);
  const [addedTo, setAddedTo] = useState<Set<string>>(new Set());
  const wsRef = useRef<HTMLDivElement>(null);

  const workspacesQuery = useQuery({
    queryKey: ["library", "projects"],
    queryFn: ({ signal }) => libraryApi.projects(signal),
    enabled: !!paper,
    select: (res) => res.projects.map((workspace) => ({ id: workspace.id, name: workspace.name })),
  });

  const addPaperMutation = useMutation({
    mutationFn: ({ workspaceName, paperId }: { workspaceName: string; paperId: string }) =>
      libraryApi.projectPapers(workspaceName, [paperId], "add"),
    onSuccess: (_res, variables) => {
      setAddedTo((prev) => new Set([...prev, variables.workspaceName]));
      queryClient.invalidateQueries({ queryKey: ["library", "projects"] });
      queryClient.invalidateQueries({
        queryKey: ["library", "projects"],
      });
    },
  });

  const workspaces = workspacesQuery.data ?? [];
  const imageQuery = useQuery({
    queryKey: ["library", "images", paper?.id],
    queryFn: ({ signal }) => libraryApi.images(paper?.id ?? "", signal),
    enabled: !!paper,
  });
  const images = imageQuery.data?.images ?? (paper?.coverImage ? [paper.coverImage] : []);
  const projectId = params.get("project") || undefined;
  const referencesQuery = useQuery({
    queryKey: ["library", "references", paper?.id, projectId],
    queryFn: ({ signal }) => libraryApi.references(paper?.id ?? "", signal, projectId),
    enabled: !!paper,
  });
  const citingQuery = useQuery({
    queryKey: ["library", "citing", paper?.id, projectId],
    queryFn: ({ signal }) => libraryApi.citing(paper?.id ?? "", signal, projectId),
    enabled: !!paper,
  });
  const references = referencesQuery.data?.references ?? [];
  const citing = citingQuery.data?.citing ?? [];
  useEffect(() => {
    if (!paper) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (wsOpen) setWsOpen(false);
        else onClose();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [paper, wsOpen, onClose]);
  const addingTo = addPaperMutation.isPending
    ? (addPaperMutation.variables?.workspaceName ?? null)
    : null;

  useEffect(() => {
    if (paper === undefined) return;
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
      role="complementary"
      aria-label="文献详情"
      inert={!paper}
      className={`fixed right-0 top-[3.25rem] bottom-0 w-[380px] max-w-full z-40 flex flex-col bg-surface-container-lowest border-l border-outline-variant/20 shadow-2xl transition-[transform,opacity] duration-[220ms] ease-in-out ${
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
              aria-label="关闭文献详情"
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
                {paper.hasPdfFile ? (
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

            {/* Image gallery */}
            {images.length > 0 ? (
              <div>
                <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-on-surface-variant/60 mb-2">
                  图片
                </p>
                <div className="flex gap-2 overflow-x-auto no-scrollbar" style={{ height: 160 }}>
                  {images.map((filename) => (
                    <img
                      key={filename}
                      src={buildPaperImageUrl(paper.id, filename)}
                      alt=""
                      loading="lazy"
                      className="h-full w-auto object-contain shrink-0"
                    />
                  ))}
                </div>
              </div>
            ) : null}

            {/* Abstract */}
            {paper.abstract ? (
              <div>
                <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-on-surface-variant/60 mb-2">
                  摘要
                </p>
                <p className="text-xs text-on-surface leading-relaxed">{paper.abstract}</p>
              </div>
            ) : null}

            {/* Citations recorded at ingestion */}
            {references.length ? (
              <div>
                <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-on-surface-variant/60 mb-2">
                  参考文献 · {references.length}
                </p>
                <ul className="space-y-1.5">
                  {references.slice(0, 20).map((reference) => (
                    <li key={reference.doi || reference.paper?.id} className="text-xs">
                      {reference.paper ? (
                        <button
                          type="button"
                          className="cursor-pointer border-0 bg-transparent p-0 text-left text-primary"
                          onClick={() =>
                            navigate(
                              `/library/${encodeURIComponent(reference.paper?.id ?? "")}?mode=overview`,
                            )
                          }
                        >
                          {reference.paper.title}
                        </button>
                      ) : (
                        <span className="text-on-surface-variant" title="不在本库中">
                          {reference.title || reference.doi}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {citing.length ? (
              <div>
                <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-on-surface-variant/60 mb-2">
                  库内被引 · {citing.length}
                </p>
                <ul className="space-y-1.5">
                  {citing.slice(0, 20).map((source) => (
                    <li key={source.id} className="text-xs">
                      <button
                        type="button"
                        className="cursor-pointer border-0 bg-transparent p-0 text-left text-primary"
                        onClick={() =>
                          navigate(`/library/${encodeURIComponent(source.id)}?mode=overview`)
                        }
                      >
                        {source.title}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>

          {addPaperMutation.error || workspacesQuery.error ? (
            <p role="alert" className="text-error px-5 text-xs">
              {(addPaperMutation.error ?? workspacesQuery.error)?.message}
            </p>
          ) : null}
          {/* Footer actions */}
          <div className="shrink-0 px-5 pb-5 pt-4 border-t border-outline-variant/10 space-y-2.5">
            {paper.hasPdfFile ? (
              <button
                type="button"
                onClick={() =>
                  navigate(
                    `/library/${encodeURIComponent(paper.id)}?returnTo=${encodeURIComponent(`/library?${params}`)}&mode=overview${params.get("project") ? `&project=${encodeURIComponent(params.get("project") ?? "")}` : ""}`,
                  )
                }
                className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-surface-container text-on-surface text-xs font-semibold hover:bg-surface-container-high transition-colors border-0 cursor-pointer"
              >
                <BookOpen className="w-3.5 h-3.5" />
                阅读文献
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
                {addingTo ? `添加到 ${addingTo}…` : "添加到文献项目"}
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
