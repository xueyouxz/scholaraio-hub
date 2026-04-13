import { FolderOpen, FolderPlus, MessageSquare, RefreshCw, Zap } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../core/api";
import type { ProjectSummary } from "../../core/types";
import { usePageTitle } from "../components/NavigationLayout";

export function ProjectsPage() {
  const { setTitle } = usePageTitle();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [path, setPath] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.getProjects();
      setProjects(data.projects);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load projects");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setTitle("Projects");
    return () => setTitle("");
  }, [setTitle]);

  const addProject = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!path.trim()) return;
    try {
      await api.addProject(path.trim());
      setPath("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add project");
    }
  };

  return (
    <div className="max-w-3xl space-y-6">
      {/* Add project form */}
      <div className="bg-surface-container-low rounded-[2rem] p-8 border border-outline-variant/10">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-3 bg-secondary-container rounded-xl text-primary">
            <FolderPlus className="w-5 h-5" />
          </div>
          <div>
            <h4 className="font-serif text-xl font-bold">Add Project</h4>
            <p className="text-xs text-on-surface-variant font-sans">
              Register a local workspace by absolute path
            </p>
          </div>
        </div>
        <form onSubmit={addProject} className="flex gap-3">
          <input
            value={path}
            onChange={(event) => setPath(event.target.value)}
            placeholder="/absolute/path/to/project"
            className="flex-1 bg-surface-container border border-outline-variant/20 rounded-xl px-4 py-2.5 text-sm font-mono text-on-surface placeholder:text-on-surface-variant/40 outline-none focus:border-primary/40 transition-colors"
          />
          <button
            type="submit"
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-on-primary text-sm font-medium border-0 cursor-pointer hover:opacity-90 transition-opacity shrink-0"
          >
            <FolderPlus className="w-4 h-4" />
            Add
          </button>
          <button
            type="button"
            onClick={() => void load()}
            title="Refresh"
            className="flex items-center justify-center w-10 h-10 rounded-xl bg-surface-container border border-outline-variant/15 text-on-surface-variant border-0 cursor-pointer hover:bg-surface-container-high transition-colors shrink-0"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </form>
        {error ? <p className="mt-3 text-sm text-error">{error}</p> : null}
      </div>

      {/* Project list */}
      <div className="space-y-3">
        {loading && projects.length === 0 ? (
          <div className="flex items-center gap-3 text-sm text-on-surface-variant/60 px-2">
            <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
            Loading projects…
          </div>
        ) : null}

        {!loading && projects.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-on-surface-variant/50">
            <FolderOpen className="w-10 h-10 opacity-30" />
            <p className="text-sm">No projects yet. Add one above.</p>
          </div>
        ) : null}

        {projects.map((project) => (
          <div
            key={project.id}
            className="flex items-center gap-4 bg-surface-container-low rounded-[1.5rem] px-6 py-5 border border-outline-variant/10 hover:border-outline-variant/20 hover:bg-surface-container transition-all group"
          >
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-secondary-container text-primary shrink-0">
              <FolderOpen className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-medium text-sm text-on-surface truncate">
                {project.name ?? project.path}
              </p>
              <p className="text-[11px] font-mono text-on-surface-variant/60 truncate mt-0.5">
                {project.path}
              </p>
            </div>
            <div className="flex items-center gap-4 shrink-0 text-on-surface-variant/60">
              <div className="flex items-center gap-1.5" title="Sessions">
                <MessageSquare className="w-3.5 h-3.5" />
                <span className="text-[11px] font-mono">{project.sessionCount}</span>
              </div>
              {project.activeOwnedCount > 0 ? (
                <div className="flex items-center gap-1 text-primary" title="Active sessions">
                  <Zap className="w-3.5 h-3.5 fill-primary/20" />
                  <span className="text-[11px] font-mono">{project.activeOwnedCount}</span>
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
