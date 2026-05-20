import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { usePageTitle } from "../../app/components/NavigationLayout";
import { type ScholarPaper, type ScholarWorkspaceSummary, scholar } from "../../core/api";
import { queryKeys } from "../../core/queryKeys";
import type { PaperReference } from "../library/types";
import { WorkspaceCard } from "./components/WorkspaceCard";
import type { WorkspaceReference } from "./types";

function toPaperRef(p: ScholarPaper): PaperReference {
  return {
    id: p.id,
    title: p.title,
    authors: p.authors,
    source: p.source,
    year: p.year,
    date: p.date,
    citations: p.citations,
    status: p.status,
    hasPdf: p.hasPdf,
    isIndexed: p.isIndexed,
    abstract: p.abstract,
  };
}

function toWorkspaceRef(w: ScholarWorkspaceSummary): WorkspaceReference {
  return { id: w.id, name: w.name, createdAt: w.createdAt, paperCount: w.paperCount, papers: [] };
}

export function WorkspacesPage() {
  const { setTitle } = usePageTitle();
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setTitle("Workspaces");
    return () => setTitle("");
  }, [setTitle]);

  const workspacesQuery = useQuery({
    queryKey: queryKeys.scholar.workspaces(),
    queryFn: ({ signal }) => scholar.getWorkspaces({ signal }),
    select: (res) => res.workspaces.map(toWorkspaceRef),
  });

  const workspaces = workspacesQuery.data ?? [];
  const expandedWorkspace = workspaces.find((w) => w.id === expandedId) ?? null;

  const workspaceQuery = useQuery({
    queryKey: expandedWorkspace
      ? queryKeys.scholar.workspace(expandedWorkspace.name)
      : ["scholar", "workspace", "idle"],
    queryFn: ({ signal }) => {
      if (!expandedWorkspace) throw new Error("Missing workspace");
      return scholar.getWorkspace(expandedWorkspace.name, { signal });
    },
    enabled: !!expandedWorkspace,
    select: (res) => res.workspace.papers.map(toPaperRef),
  });

  const createWorkspaceMutation = useMutation({
    mutationFn: (name: string) => scholar.createWorkspace(name),
    onSuccess: (res) => {
      queryClient.setQueryData<{ workspaces: ScholarWorkspaceSummary[] }>(
        queryKeys.scholar.workspaces(),
        (current) => ({
          workspaces: [
            ...(current?.workspaces.filter((workspace) => workspace.id !== res.workspace.id) ?? []),
            res.workspace,
          ],
        }),
      );
      queryClient.setQueryData(queryKeys.scholar.workspace(res.workspace.name), res);
      queryClient.invalidateQueries({ queryKey: queryKeys.scholar.workspaces() });
      setExpandedId(res.workspace.id);
      setDraftName("");
    },
    onError: (e) => setActionError(e instanceof Error ? e.message : "创建失败"),
  });

  useEffect(() => {
    setExpandedId((prev) => {
      if (workspaces.length === 0) return null;
      if (prev && workspaces.some((workspace) => workspace.id === prev)) return prev;
      return workspaces[0]?.id ?? null;
    });
  }, [workspaces]);

  const toggle = (id: string) => setExpandedId((prev) => (prev === id ? null : id));

  const handleCreate = () => {
    const name = draftName.trim();
    if (!name) return;
    setActionError(null);
    createWorkspaceMutation.mutate(name);
  };

  const loading = workspacesQuery.isLoading;
  const creating = createWorkspaceMutation.isPending;
  const queryError = workspacesQuery.error ?? workspaceQuery.error;
  const error =
    actionError ??
    (queryError instanceof Error
      ? queryError.message
      : queryError
        ? "加载失败，请确认 scholaraio serve 已启动"
        : null);
  const expandedPapers = workspaceQuery.data ?? [];

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="rounded-xl border border-outline-variant/10 bg-surface-container-low p-4 flex gap-3">
        <input
          data-draft-input
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          placeholder="新建文献主题工作区"
          className="flex-1 rounded-xl bg-surface-container-high px-3 py-2 text-sm text-on-surface placeholder:text-on-surface-variant outline-none"
        />
        <button
          type="button"
          disabled={creating || !draftName.trim()}
          onClick={handleCreate}
          className="px-4 py-2 rounded-xl signature-gradient text-on-primary text-sm font-semibold disabled:opacity-50"
        >
          {creating ? "创建中…" : "Create"}
        </button>
      </div>

      {error ? (
        <div className="rounded-xl bg-error-container/10 border border-error/20 p-4 text-sm text-error">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="text-center text-on-surface-variant text-sm py-20">加载中…</div>
      ) : (
        <section className="space-y-4">
          {workspaces.length === 0 ? (
            <div className="text-center text-on-surface-variant text-sm py-20">
              暂无工作区。在上方输入名称创建第一个工作区，或在 scholaraio 目录下运行{" "}
              <code className="font-mono">scholaraio ws init &lt;name&gt;</code>。
            </div>
          ) : (
            workspaces.map((workspace) => (
              <WorkspaceCard
                key={workspace.id}
                workspace={{
                  ...workspace,
                  papers: expandedId === workspace.id ? expandedPapers : [],
                }}
                expanded={expandedId === workspace.id}
                onToggle={() => toggle(workspace.id)}
              />
            ))
          )}
        </section>
      )}
    </div>
  );
}
