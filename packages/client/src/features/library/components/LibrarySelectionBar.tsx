import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, MessageSquare, X } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { libraryApi, newSessionUrl } from "../../../core/library";
import { useLibrarySelection } from "../selection";
import { useExportReferences } from "../useExportReferences";
import { BatchAddDropdown } from "./BatchAddDropdown";

const FORMATS = [
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
  const [params] = useSearchParams();
  const projectId = params.get("project") ?? undefined;
  const client = useQueryClient();
  const [format, setFormat] = useState("bibtex");
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
        failed: [] as { id: string; reason: string }[],
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
      <label className="sr-only" htmlFor="selection-export-format">
        导出格式
      </label>
      <select
        id="selection-export-format"
        className="hub-input py-1 text-sm"
        value={format}
        onChange={(event) => setFormat(event.target.value)}
      >
        {FORMATS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="hub-button"
        disabled={save.isPending}
        onClick={() => save.mutate({ paperIds: ids, projectId, format })}
      >
        <Download size={14} />
        {save.isPending ? "导出中…" : "导出引用"}
      </button>
      <Link className="hub-button" to={newSessionUrl(projectId, ids)}>
        <MessageSquare size={14} />
        询问选中的
      </Link>
      <BatchAddDropdown
        workspaces={projects.data?.projects.map((p) => ({ id: p.id, name: p.name })) ?? []}
        pending={add.isPending}
        selectedCount={ids.length}
        onAdd={(project) => add.mutate({ project, create: false })}
        onCreateAndAdd={(project) => add.mutate({ project, create: true })}
      />
      <button
        type="button"
        aria-label="清除选择"
        className="p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-container-high border-0 bg-transparent cursor-pointer"
        onClick={selection.clear}
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
