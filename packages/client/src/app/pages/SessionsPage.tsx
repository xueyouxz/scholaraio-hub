import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, providerLabel } from "../../core/api";
import type { AppSessionSummary, ProjectSummary } from "../../core/types";

export function SessionsPage() {
  const [params, setParams] = useSearchParams();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [sessions, setSessions] = useState<AppSessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const projectId = params.get("project") ?? "";

  useEffect(() => {
    void (async () => {
      try {
        const projectData = await api.getProjects();
        setProjects(projectData.projects);
        const effectiveProjectId = projectId || projectData.projects[0]?.id || "";
        if (!projectId && effectiveProjectId) {
          setParams({ project: effectiveProjectId }, { replace: true });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load projects");
      }
    })();
  }, [projectId, setParams]);

  useEffect(() => {
    if (!projectId) return;
    void (async () => {
      setLoading(true);
      setError("");
      try {
        const data = await api.getProjectSessions(projectId);
        setSessions(data.sessions);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load sessions");
      } finally {
        setLoading(false);
      }
    })();
  }, [projectId]);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === projectId) ?? null,
    [projectId, projects],
  );

  return (
    <section className="panel">
      <div className="panel-header">
        <h2 className="title">Sessions</h2>
      </div>
      <div className="panel-body stack">
        <select value={projectId} onChange={(event) => setParams({ project: event.target.value })}>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name ?? project.path}
            </option>
          ))}
        </select>
        {selectedProject ? <div className="muted">{selectedProject.path}</div> : null}
        {error ? <div className="empty">{error}</div> : null}
        {loading ? <div className="empty">Loading sessions…</div> : null}
        <div className="list">
          {sessions.map((session) => (
            <Link
              key={session.id}
              to={`/projects/${session.projectId}/sessions/${session.id}`}
              className="card"
            >
              <div className="card-title">{session.customTitle ?? session.title ?? "Untitled"}</div>
              <div className="card-meta">
                <span>{providerLabel(session.provider)}</span>
                <span>{session.messageCount} messages</span>
                <span>{new Date(session.updatedAt).toLocaleString()}</span>
              </div>
            </Link>
          ))}
          {!loading && sessions.length === 0 ? (
            <div className="empty">No sessions found.</div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
