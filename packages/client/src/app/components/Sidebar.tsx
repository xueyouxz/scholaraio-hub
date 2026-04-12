import type { AppSessionSummary } from "@scholaraio-hub/shared";
import { useEffect, useMemo, useState } from "react";
import { Link, NavLink, useLocation, useParams, useSearchParams } from "react-router-dom";
import { api, providerLabel } from "../../core/api";
import type { ProjectSummary } from "../../core/types";

const links = [
  { to: "/projects", label: "Projects" },
  { to: "/sessions", label: "Sessions" },
  { to: "/agents", label: "Agents" },
  { to: "/new-session", label: "New Session" },
  { to: "/settings", label: "Settings" },
];

export function Sidebar() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { projectId, sessionId } = useParams();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [sessions, setSessions] = useState<AppSessionSummary[]>([]);

  const activeProjectId =
    projectId ??
    (location.pathname.startsWith("/sessions") ? (searchParams.get("project") ?? "") : "");

  useEffect(() => {
    void api
      .getProjects()
      .then((data) => setProjects(data.projects))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!activeProjectId) {
      setSessions([]);
      return;
    }
    void api
      .getProjectSessions(activeProjectId)
      .then((data) => setSessions(data.sessions.slice(0, 12)))
      .catch(() => {});
  }, [activeProjectId]);

  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? null,
    [activeProjectId, projects],
  );

  return (
    <aside className="sidebar-shell">
      <div className="sidebar-brand">
        <p className="sidebar-tag">The Digital Atelier</p>
        <h1>ScholarAIO Hub</h1>
        <p className="muted">Local workbench for sessions, projects, and processes.</p>
      </div>

      <nav className="sidebar-nav">
        {links.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            className={({ isActive }) => `sidebar-link${isActive ? " active" : ""}`}
          >
            {link.label}
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-section">
        <p className="eyebrow">Project Scope</p>
        {activeProject ? (
          <>
            <div className="sidebar-project-card">
              <strong>{activeProject.name ?? activeProject.path}</strong>
              <span className="muted">{activeProject.path}</span>
            </div>
            <div className="sidebar-session-list">
              {sessions.map((session) => (
                <Link
                  key={session.id}
                  to={`/projects/${session.projectId}/sessions/${session.id}`}
                  className={`sidebar-session-item${session.id === sessionId ? " active" : ""}`}
                >
                  <span>{session.customTitle ?? session.title ?? "Untitled"}</span>
                  <span className="muted">
                    {providerLabel(session.provider)} · {session.messageCount}
                  </span>
                </Link>
              ))}
              {sessions.length === 0 ? (
                <div className="muted">No sessions in this project.</div>
              ) : null}
            </div>
          </>
        ) : (
          <div className="muted">Select a project to browse local sessions.</div>
        )}
      </div>
    </aside>
  );
}
