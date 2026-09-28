import type { LiteratureRef } from "@scholaraio-hub/shared";
import { useQuery } from "@tanstack/react-query";
import { FileText, Library, X } from "lucide-react";
import { libraryApi } from "../../../core/library";
import { ResizableSessionPanel } from "./ResizableSessionPanel";

interface PaperRowProps {
  title: string;
  authors: string;
  year: number;
  selected: boolean;
  onClick: () => void;
}

function PaperRow({ title, authors, year, selected, onClick }: PaperRowProps) {
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

interface ReferencesPanelProps {
  references: LiteratureRef[];
  selectedPaperId: string | null;
  onSelectPaper: (paperId: string | null) => void;
  /** Stop referring to one; the session answers from the rest from then on. */
  onRemove?: (reference: LiteratureRef) => void;
  disabled?: boolean;
  onClose: () => void;
}

/** The literature a session refers to: whole collections and single papers, each removable. */
export function ReferencesPanel({
  references,
  selectedPaperId,
  onSelectPaper,
  onRemove,
  disabled,
  onClose,
}: ReferencesPanelProps) {
  const library = useQuery({
    queryKey: ["library", "session-references", references],
    queryFn: async ({ signal }) => {
      const [collections, papers] = await Promise.all([
        references.some((ref) => ref.kind === "collection")
          ? libraryApi.collections(signal)
          : { collections: [] },
        libraryApi.papers(signal),
      ]);
      return { collections: collections.collections, papers: papers.papers };
    },
    staleTime: 30_000,
  });
  const paper = (id: string) => library.data?.papers.find((item) => item.id === id);
  const row = (id: string) => {
    const found = paper(id);
    return (
      <PaperRow
        key={id}
        title={found?.title ?? id}
        authors={found?.authors ?? ""}
        year={Number(found?.year ?? 0)}
        selected={selectedPaperId === id}
        onClick={() => onSelectPaper(selectedPaperId === id ? null : id)}
      />
    );
  };
  const remove = (reference: LiteratureRef, name: string) =>
    onRemove ? (
      <button
        type="button"
        disabled={disabled}
        onClick={() => onRemove(reference)}
        className="shrink-0 p-1 rounded text-on-surface-variant hover:text-error transition-colors"
        title={`不再引用 ${name}`}
        aria-label={`不再引用 ${name}`}
      >
        <X size={12} />
      </button>
    ) : null;

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between px-3 py-2 border-b border-outline-variant/10 shrink-0">
        <span className="text-xs font-medium text-on-surface-variant uppercase tracking-wide truncate">
          引用的文献
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-on-surface-variant hover:text-on-surface transition-colors"
          title="关闭引用的文献"
          aria-label="关闭引用的文献"
        >
          <X size={13} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto min-h-0 py-1 px-1">
        {library.isLoading ? (
          <div className="px-3 py-4 text-xs text-on-surface-variant animate-pulse">加载中…</div>
        ) : library.error ? (
          <div className="px-3 py-4 text-xs text-error">
            {library.error.message}
            <button
              type="button"
              onClick={() => void library.refetch()}
              className="mt-2 block text-[10px] font-mono underline hover:text-on-surface"
            >
              重试
            </button>
          </div>
        ) : references.length === 0 ? (
          <div className="px-3 py-4 text-xs text-on-surface-variant italic">
            还没有引用文献。在输入框中输入 @ 引用文献集合或单篇文献。
          </div>
        ) : (
          references.map((reference) => {
            if (reference.kind === "paper") {
              const name = paper(reference.id)?.title ?? reference.id;
              return (
                <div key={`paper:${reference.id}`} className="flex items-start gap-1">
                  <FileText size={12} className="mt-2.5 ml-1 shrink-0 text-on-surface-variant" />
                  <div className="flex-1 min-w-0">{row(reference.id)}</div>
                  {remove(reference, name)}
                </div>
              );
            }
            const collection = library.data?.collections.find(
              (item) => item.id === reference.id || item.name === reference.id,
            );
            const name = collection?.name ?? reference.id;
            return (
              <section key={`collection:${reference.id}`} className="mb-2">
                <div className="flex items-center gap-1.5 px-2 py-1.5">
                  <Library size={12} className="shrink-0 text-primary" />
                  <span className="flex-1 min-w-0 truncate text-xs font-semibold text-on-surface">
                    {name}
                  </span>
                  <span className="text-[10px] font-mono text-on-surface-variant">
                    {collection ? collection.paperCount : "已不存在"}
                  </span>
                  {remove(reference, name)}
                </div>
                <div className="pl-3">{collection?.paperIds.map(row)}</div>
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}

export function ResizableReferencesPanel({
  open,
  ...props
}: ReferencesPanelProps & { open: boolean }) {
  return (
    <ResizableSessionPanel
      open={open}
      title="引用的文献"
      storageKey="references-panel-width"
      onClose={props.onClose}
    >
      <ReferencesPanel {...props} />
    </ResizableSessionPanel>
  );
}
