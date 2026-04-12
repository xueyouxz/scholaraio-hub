import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../core/api";
import type { ProjectSummary } from "../../core/types";

export function ProjectsPage() {
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
    <>
      <div className="panel-header">
        <h2 className="title">Projects</h2>
      </div>
      <div className="panel-body stack">
        <form className="stack" onSubmit={addProject}>
          <input
            value={path}
            onChange={(event) => setPath(event.target.value)}
            placeholder="/absolute/path/to/project"
          />
          <div className="toolbar">
            <button type="submit" className="primary">
              Add Project
            </button>
            <button type="button" className="ghost" onClick={() => void load()}>
              Refresh
            </button>
          </div>
        </form>
        {error ? <div className="empty">{error}</div> : null}
        {loading ? <div className="empty">Loading projects…</div> : null}
        <div className="list">
          {projects.map((project) => (
            <Link key={project.id} to={`/sessions?project=${project.id}`} className="card">
              <div className="card-title">{project.name ?? project.path}</div>
              <div className="card-meta">
                <span>{project.path}</span>
                <span>{project.sessionCount} sessions</span>
                <span>{project.activeOwnedCount} active</span>
              </div>
            </Link>
          ))}
          {!loading && projects.length === 0 ? <div className="empty">No projects yet.</div> : null}
        </div>
      </div>
    </>
  );
}
