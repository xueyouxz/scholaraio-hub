import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Download, MessageSquare, X } from "lucide-react";
import { Link } from "react-router-dom";
import { type ReferenceFormat, libraryApi } from "../../../core/library";
import { newSessionUrl } from "../../../core/sessions";
import { MenuOption, Popover } from "../../../shared/ui/Menu";
import { useLibrarySelection } from "../selection";
import { useExportReferences } from "../useExportReferences";
import { AddToCollectionMenu } from "./AddToCollectionMenu";

const FORMATS: { value: ReferenceFormat; label: string }[] = [
  { value: "bibtex", label: "BibTeX" },
  { value: "ris", label: "RIS" },
  { value: "markdown", label: "Markdown" },
];

/**
 * What can be done with the papers picked out, wherever they were picked.
 *
 * One bar for every library view: the actions follow the selection instead of
 * living in the view that happened to create it.
 */
export function LibrarySelectionBar() {
  const selection = useLibrarySelection();
  const client = useQueryClient();
  const ids = [...selection.selected];

  const projects = useQuery({
    queryKey: ["library", "collections"],
    queryFn: ({ signal }) => libraryApi.collections(signal),
    enabled: ids.length > 0,
  });
  const invalidate = (project: string) => {
    void client.invalidateQueries({ queryKey: ["library", "collections"] });
    void client.invalidateQueries({ queryKey: ["library", "collection", project] });
  };
  const add = useMutation({
    mutationFn: async ({ project, create }: { project: string; create: boolean }) => {
      if (create) await libraryApi.createCollection(project);
      const before = create ? { paperIds: [] } : await libraryApi.collection(project);
      const existing = new Set(before.paperIds);
      await libraryApi.collectionPapers(project, ids, "add");
      return {
        added: ids.filter((id) => !existing.has(id)),
        skipped: ids.filter((id) => existing.has(id)).map((id) => ({ id })),
      };
    },
    onSuccess: (outcome, { project }) => {
      selection.resolve(outcome, project);
      selection.note(`${outcome.added.length} 已加入 · ${outcome.skipped.length} 已存在`);
      invalidate(project);
    },
    onError: (error: Error) => selection.note(`加入失败：${error.message}`),
  });
  const save = useExportReferences();

  if (ids.length === 0) return null;
  return (
    <div
      aria-label="选中文献的操作"
      className="shrink-0 flex flex-wrap items-center gap-2 px-6 py-2.5 border-t border-outline-variant/15 bg-surface-container-low"
    >
      <span className="text-sm text-on-surface font-medium">已选 {ids.length} 篇</span>
      {selection.notice ? (
        <p className="text-xs font-mono text-on-surface-variant">{selection.notice}</p>
      ) : null}
      {save.error ? (
        <p role="alert" className="text-xs text-error">
          {save.error.message}
        </p>
      ) : null}
      <div className="flex-1" />
      <ExportMenu
        pending={save.isPending}
        onExport={(format) => save.mutate({ paperIds: ids, format })}
      />
      <Link
        to={newSessionUrl({ references: ids.map((id) => ({ kind: "paper" as const, id })) })}
        className="btn-pill px-3 py-1.5 text-sm"
      >
        <MessageSquare className="w-3.5 h-3.5" aria-hidden="true" />
        询问选中的
      </Link>
      <AddToCollectionMenu
        workspaces={projects.data?.collections.map((p) => ({ id: p.id, name: p.name })) ?? []}
        pending={add.isPending}
        selectedCount={ids.length}
        onAdd={(project) => add.mutate({ project, create: false })}
        onCreateAndAdd={(project) => add.mutate({ project, create: true })}
      />
      <button
        type="button"
        aria-label="清除选择"
        className="btn-ghost p-1.5"
        onClick={selection.clear}
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

/** Export the selection, in the format chosen at the moment of asking. */
function ExportMenu({
  pending,
  onExport,
}: {
  pending: boolean;
  onExport: (format: ReferenceFormat) => void;
}) {
  return (
    <Popover
      disabled={pending}
      placement="above"
      align="end"
      panelRole="menu"
      panelClassName="w-40"
      triggerClassName="btn-pill px-3 py-1.5 text-sm"
      trigger={(open) => (
        <>
          <Download className="w-3.5 h-3.5" aria-hidden="true" />
          {pending ? "导出中…" : "导出引用"}
          <ChevronDown
            className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </>
      )}
    >
      {(close) =>
        FORMATS.map((option) => (
          <MenuOption
            key={option.value}
            label={option.label}
            onSelect={() => {
              close();
              onExport(option.value);
            }}
          />
        ))
      }
    </Popover>
  );
}
