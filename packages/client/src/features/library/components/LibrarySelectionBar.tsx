import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Download, MessageSquare, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { type ReferenceFormat, libraryApi } from "../../../core/library";
import { newSessionUrl } from "../../../core/sessions";
import { useLibrarySelection } from "../selection";
import { useExportReferences } from "../useExportReferences";
import { AddToWorkspaceMenu } from "./AddToWorkspaceMenu";

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
    queryKey: ["library", "projects"],
    queryFn: ({ signal }) => libraryApi.projects(signal),
    enabled: ids.length > 0,
  });
  const invalidate = (project: string) => {
    void client.invalidateQueries({ queryKey: ["library", "projects"] });
    void client.invalidateQueries({ queryKey: ["library", "project", project] });
  };
  const add = useMutation({
    mutationFn: async ({ project, create }: { project: string; create: boolean }) => {
      if (create) await libraryApi.createProject(project);
      const before = create ? { paperIds: [] } : await libraryApi.project(project);
      const existing = new Set(before.paperIds);
      await libraryApi.projectPapers(project, ids, "add");
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
        to={newSessionUrl(undefined, ids)}
        className="inline-flex items-center gap-1.5 rounded-full bg-surface-container-high px-3 py-1.5 text-sm font-medium text-on-surface active:scale-95"
      >
        <MessageSquare className="w-3.5 h-3.5" aria-hidden="true" />
        询问选中的
      </Link>
      <AddToWorkspaceMenu
        workspaces={projects.data?.projects.map((p) => ({ id: p.id, name: p.name })) ?? []}
        pending={add.isPending}
        selectedCount={ids.length}
        onAdd={(project) => add.mutate({ project, create: false })}
        onCreateAndAdd={(project) => add.mutate({ project, create: true })}
      />
      <button
        type="button"
        aria-label="清除选择"
        className="rounded-full p-1.5 text-on-surface-variant hover:bg-surface-container-high active:opacity-80 border-0 bg-transparent cursor-pointer"
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
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (menu.current && !menu.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);
  return (
    <div className="relative" ref={menu}>
      <button
        type="button"
        disabled={pending}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex items-center gap-1.5 rounded-full bg-surface-container-high px-3 py-1.5 text-sm font-medium text-on-surface active:scale-95 disabled:opacity-40 border-0 cursor-pointer"
      >
        <Download className="w-3.5 h-3.5" aria-hidden="true" />
        {pending ? "导出中…" : "导出引用"}
        <ChevronDown
          className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>
      {open ? (
        <div className="absolute bottom-[calc(100%+6px)] right-0 z-30 w-40 rounded-xl border border-outline-variant/20 bg-surface-container-high p-2 shadow-xl">
          {FORMATS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                setOpen(false);
                onExport(option.value);
              }}
              className="w-full rounded-lg px-3 py-2 text-left text-sm text-on-surface hover:bg-surface-container-low border-0 bg-transparent cursor-pointer"
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
