import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, providerLabel } from "../../core/api";
import { queryKeys } from "../../core/queryKeys";

export function AgentsPage() {
  const processesQuery = useQuery({
    queryKey: queryKeys.processes(),
    queryFn: () => api.getProcesses(),
    select: (data) => [...(data.processes ?? []), ...(data.terminatedProcesses ?? [])],
  });

  const processes = processesQuery.data ?? [];
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
      </div>
      <div className="panel-body stack">
        {error ? <div className="empty">{error}</div> : null}
        <div className="list">
          {processes.map((process) => (
            <Link
              key={process.id}
              to={`/projects/${process.projectId}/sessions/${process.sessionId}`}
              className="card"
            >
              <div className="card-title">{process.sessionTitle ?? process.sessionId}</div>
              <div className="card-meta">
                <span>{providerLabel(process.provider)}</span>
                <span>
                  {typeof process.state === "string"
                    ? process.state
                    : (process.state?.type ?? "unknown")}
                </span>
                {process.model ? <span>{process.model}</span> : null}
              </div>
            </Link>
          ))}
          {processes.length === 0 ? (
            <div className="empty">No active or recent processes.</div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
