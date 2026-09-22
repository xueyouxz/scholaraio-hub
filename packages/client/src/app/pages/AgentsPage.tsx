import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { libraryApi, providerLabel, sessionApi } from "../../core/library";

export function AgentsPage() {
  const [params] = useSearchParams();
  const projectId = params.get("project");
  const projects = useQuery({
    queryKey: ["library", "projects"],
    queryFn: ({ signal }) => libraryApi.projects(signal),
  });
  const processesQuery = useQuery({
    queryKey: ["sessions"],
    queryFn: ({ signal }) => sessionApi.list(signal),
    refetchInterval: 3000,
    select: (data) => data.sessions,
  });

  const processes = (processesQuery.data ?? []).filter(
    (session) =>
      (!session.projectId ||
        projects.data?.projects.some((project) => project.id === session.projectId)) &&
      (!projectId || session.projectId === projectId),
  );
  const error =
    processesQuery.error instanceof Error
      ? processesQuery.error.message
      : processesQuery.error
        ? "Failed to load processes"
        : "";

  return (
    <section className="panel">
      <div className="panel-header">
        <h2 className="title">Agents</h2>
        <Link to="/projects" className="text-xs text-primary">
          Projects
        </Link>
      </div>
      <div className="panel-body stack">
        {error ? <div className="empty">{error}</div> : null}
        <div className="list">
          {processes.map((process) => (
            <Link key={process.id} to={`/sessions/${process.id}`} className="card">
              <div className="card-title">{process.title}</div>
              <div className="card-meta">
                <span>{providerLabel(process.provider)}</span>
                <span>
                  {
                    {
                      idle: "已完成",
                      running: "运行中",
                      "waiting-input": "等待确认",
                      interrupted: "已停止",
                      error: "出错",
                    }[process.state]
                  }
                </span>
                {process.model ? <span>{process.model}</span> : null}
              </div>
            </Link>
          ))}
          {processes.length === 0 ? (
            <div className="empty">
              {processesQuery.isLoading || projects.isLoading ? "加载会话…" : "暂无会话"}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
