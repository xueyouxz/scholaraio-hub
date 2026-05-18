import { useCallback, useEffect, useState } from "react";
import { usePageTitle } from "../../app/components/NavigationLayout";
import { type ScholarPaper, type ScholarWorkspaceSummary, scholar } from "../../core/api";
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
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [workspaces, setWorkspaces] = useState<WorkspaceReference[]>([]);
  const [papersByWsId, setPapersByWsId] = useState<Record<string, PaperReference[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    setTitle("Workspaces");
    return () => setTitle("");
  }, [setTitle]);

  const load = useCallback(() => {
    setLoading(true);
    scholar
      .getWorkspaces()
      .then((res) => {
        const ws = res.workspaces.map(toWorkspaceRef);
        setWorkspaces(ws);
        if (ws.length > 0) setExpandedId((prev) => prev ?? ws[0]?.id ?? null);
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : "加载失败，请确认 scholaraio serve 已启动"),
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Lazily load papers the first time a workspace is expanded
  useEffect(() => {
    if (!expandedId) return;
    if (papersByWsId[expandedId]) return; // already loaded

    const ws = workspaces.find((w) => w.id === expandedId);
    if (!ws) return;

    scholar
      .getWorkspace(ws.name)
      .then((res) => {
        setPapersByWsId((prev) => ({
          ...prev,
          [expandedId]: res.workspace.papers.map(toPaperRef),
        }));
      })
      .catch(() => {
        setPapersByWsId((prev) => ({ ...prev, [expandedId]: [] }));
      });
  }, [expandedId, workspaces, papersByWsId]);

  const toggle = (id: string) => setExpandedId((prev) => (prev === id ? null : id));

  const handleCreate = () => {
    const name = draftName.trim();
    if (!name) return;
    setCreating(true);
    scholar
      .createWorkspace(name)
      .then((res) => {
        setWorkspaces((prev) => [...prev, toWorkspaceRef(res.workspace)]);
        setExpandedId(res.workspace.id);
        setDraftName("");
      })
      .catch((e) => setError(e instanceof Error ? e.message : "创建失败"))
      .finally(() => setCreating(false));
  };

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
                workspace={{ ...workspace, papers: papersByWsId[workspace.id] ?? [] }}
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
