import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, providerLabel } from "../../core/api";
import { queryKeys } from "../../core/queryKeys";

export function SessionsPage() {
  const [params, setParams] = useSearchParams();
  const projectId = params.get("project") ?? "";

  const projectsQuery = useQuery({
    queryKey: queryKeys.projects(),
    queryFn: ({ signal }) => api.getProjects({ signal }),
    select: (data) => data.projects,
  });

  const projects = projectsQuery.data ?? [];

  useEffect(() => {
    if (projectId) return;
    const fallback = projects[0]?.id;
    if (fallback) {
      setParams({ project: fallback }, { replace: true });
    }
  }, [projectId, projects, setParams]);

  const sessionsQuery = useQuery({
    queryKey: queryKeys.projectSessions(projectId),
    queryFn: ({ signal }) => api.getProjectSessions(projectId, { signal }),
    select: (data) => data.sessions,
    enabled: !!projectId,
  });

  const sessions = sessionsQuery.data ?? [];
  const loading = !!projectId && sessionsQuery.isLoading;
  const error =
    (projectsQuery.error instanceof Error && projectsQuery.error.message) ||
    (sessionsQuery.error instanceof Error && sessionsQuery.error.message) ||
    (projectsQuery.error || sessionsQuery.error ? "Failed to load sessions" : "");

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
