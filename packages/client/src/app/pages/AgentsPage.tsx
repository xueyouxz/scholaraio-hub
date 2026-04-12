import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, providerLabel } from "../../core/api";
import type { ProcessSummary } from "../../core/types";

export function AgentsPage() {
  const [processes, setProcesses] = useState<ProcessSummary[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const data = await api.getProcesses();
        setProcesses([...(data.processes ?? []), ...(data.terminatedProcesses ?? [])]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load processes");
      }
    })();
  }, []);

  return (
    <>
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
    </>
  );
}
