import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { libraryApi, readerUrl } from "../../../core/library";
import { Badge } from "../../../shared/ui/Badge";
import { paperAssetUrl } from "../paperSummary";
import type { PaperSummary } from "../paperSummary";
import { AddToCollectionMenu } from "./AddToCollectionMenu";
import { StatusBadge } from "./StatusBadge";

interface Props {
  /** The workspace the panel is shown in; scopes references and the reader. */
  collectionId?: string;
  paper: PaperSummary | null;
  onClose: () => void;
}

export function PaperDetailPanel({ paper, collectionId, onClose }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  // Every paper opened from here comes back to this page, in this workspace.
  const openReader = (paperId: string) =>
    navigate(
      readerUrl(paperId, {
        collectionId,
        returnTo: `${location.pathname}${location.search}`,
      }),
    );
  const queryClient = useQueryClient();
  const [addedTo, setAddedTo] = useState<Set<string>>(new Set());
  // Another paper starts with nothing added yet.
  const [shownId, setShownId] = useState(paper?.id);
  if (shownId !== paper?.id) {
    setShownId(paper?.id);
    setAddedTo(new Set());
  }

  const workspacesQuery = useQuery({
    queryKey: ["library", "collections"],
    queryFn: ({ signal }) => libraryApi.collections(signal),
    enabled: !!paper,
    select: (res) =>
      res.collections.map((workspace) => ({ id: workspace.id, name: workspace.name })),
  });

  const addPaperMutation = useMutation({
    mutationFn: async ({
      collection,
      paperId,
      create,
    }: { collection: string; paperId: string; create: boolean }) => {
      if (create) await libraryApi.createCollection(collection);
      await libraryApi.collectionPapers(collection, [paperId], "add");
    },
    onSuccess: (_res, variables) => {
      setAddedTo((prev) => new Set([...prev, variables.collection]));
      queryClient.invalidateQueries({ queryKey: ["library", "collections"] });
    },
  });

  const workspaces = workspacesQuery.data ?? [];
  const imageQuery = useQuery({
    queryKey: ["library", "images", paper?.id],
    queryFn: ({ signal }) => libraryApi.images(paper?.id ?? "", signal),
    enabled: !!paper,
  });
  const images = imageQuery.data?.images ?? (paper?.coverImage ? [paper.coverImage] : []);
  const referencesQuery = useQuery({
    queryKey: ["library", "references", paper?.id, collectionId],
    queryFn: ({ signal }) => libraryApi.references(paper?.id ?? "", signal, collectionId),
    enabled: !!paper,
  });
  const citingQuery = useQuery({
    queryKey: ["library", "citing", paper?.id, collectionId],
    queryFn: ({ signal }) => libraryApi.citing(paper?.id ?? "", signal, collectionId),
    enabled: !!paper,
  });
  const references = referencesQuery.data?.references ?? [];
  const citing = citingQuery.data?.citing ?? [];
  const [doiDraft, setDoiDraft] = useState("");
  const refreshPaper = () => {
    queryClient.invalidateQueries({ queryKey: ["library"] });
  };
  const correctMetadata = useMutation({
    mutationFn: ({ id, doi }: { id: string; doi: string }) => libraryApi.updatePaper(id, { doi }),
    onSuccess: refreshPaper,
  });
  const refetchMetadata = useMutation({
    mutationFn: (id: string) => libraryApi.refetchPaper(id),
    onSuccess: refreshPaper,
  });
  useEffect(() => {
    if (!paper) return;
    const handler = (event: KeyboardEvent) => {
      // An open menu in the panel takes the first Escape (see useDismiss).
      if (event.key === "Escape" && !event.defaultPrevented) onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [paper, onClose]);
  const addingTo = addPaperMutation.isPending
    ? (addPaperMutation.variables?.collection ?? null)
    : null;
  const addTo = (collection: string, create: boolean) => {
    if (!paper || addingTo) return;
    addPaperMutation.mutate({ collection, paperId: paper.id, create });
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
              className="btn-ghost p-1.5 shrink-0 mt-0.5"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
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
                {paper.hasPdf ? <Badge tone="kind">PDF</Badge> : null}
              </div>
            </div>

            {/* Image gallery */}
            {images.length > 0 ? (
              <div>
                <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-on-surface-variant/60 mb-2">
                  图片
                </p>
                <div className="flex gap-2 overflow-x-auto" style={{ height: 160 }}>
                  {images.map((filename) => (
                    <img
                      key={filename}
                      src={paperAssetUrl(paper.id, filename)}
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

            {/* Metadata the pipeline could not establish */}
            {paper.metadataStatus === "incomplete" ? (
              <div className="rounded-xl bg-surface-container p-3">
                <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-on-surface-variant/60 mb-2">
                  元数据不完整
                  {paper.missingMetadata?.length ? ` · 缺 ${paper.missingMetadata.join("、")}` : ""}
                </p>
                <form
                  className="flex gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const doi = doiDraft.trim();
                    if (doi) correctMetadata.mutate({ id: paper.id, doi });
                  }}
                >
                  <input
                    value={doiDraft}
                    onChange={(event) => setDoiDraft(event.target.value)}
                    placeholder="补充 DOI"
                    aria-label="补充 DOI"
                    className="min-w-0 flex-1 rounded-lg bg-surface-container-low px-3 py-1.5 text-xs outline-none"
                  />
                  <button
                    type="submit"
                    disabled={correctMetadata.isPending || !doiDraft.trim()}
                    className="hub-button shrink-0 disabled:opacity-50"
                  >
                    保存
                  </button>
                </form>
                <p className="mt-2 text-[11px] text-on-surface-variant/70">
                  保存后可重新查询，补齐期刊、年份与引用数据。
                </p>
              </div>
            ) : null}

            {paper.doi ? (
              <button
                type="button"
                disabled={refetchMetadata.isPending}
                onClick={() => refetchMetadata.mutate(paper.id)}
                className="hub-button disabled:opacity-50"
              >
                {refetchMetadata.isPending ? "查询中…" : "重新查询元数据"}
              </button>
            ) : null}

            {correctMetadata.error || refetchMetadata.error ? (
              <p role="alert" className="text-xs text-error">
                {(correctMetadata.error ?? refetchMetadata.error)?.message}
              </p>
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
                          onClick={() => openReader(reference.paper?.id ?? "")}
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
                        onClick={() => openReader(source.id)}
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
            {paper.hasPdf ? (
              <button
                type="button"
                onClick={() => openReader(paper.id)}
                className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-surface-container text-on-surface text-xs font-semibold hover:bg-surface-container-high transition-colors border-0 cursor-pointer"
              >
                <BookOpen className="w-3.5 h-3.5" />
                阅读文献
              </button>
            ) : null}

            <AddToCollectionMenu
              wide
              workspaces={workspaces}
              pending={!!addingTo}
              label={addingTo ? `添加到 ${addingTo}…` : "添加到文献集合"}
              added={addedTo}
              onAdd={(collection) => addTo(collection, false)}
              onCreateAndAdd={(collection) => addTo(collection, true)}
            />
          </div>
        </>
      ) : null}
    </div>
  );
}
