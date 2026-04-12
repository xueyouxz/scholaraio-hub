import { Link } from "react-router-dom";

interface SessionHeaderProps {
  projectId: string;
  title: string;
  providerLabel: string;
  modelLabel: string;
  ownershipLabel: string;
  liveStatus: string | null;
  connected: boolean;
}

export function SessionHeader({
  projectId,
  title,
  providerLabel,
  modelLabel,
  ownershipLabel,
  liveStatus,
  connected,
}: SessionHeaderProps) {
  return (
    <header className="session-workspace-header">
      <div className="session-header-topline">
        <Link to={`/sessions?project=${projectId}`} className="button ghost">
          Back
        </Link>
        <div className={`connection-dot${connected ? " connected" : ""}`} />
      </div>
      <div className="session-header-main">
        <div>
          <p className="eyebrow">Session Workspace</p>
          <h1>{title}</h1>
        </div>
        <div className="session-header-meta">
          <span className="badge">{providerLabel}</span>
          <span className="badge">{modelLabel}</span>
          <span className="badge">{ownershipLabel}</span>
          {liveStatus ? <span className="badge waiting">{liveStatus}</span> : null}
        </div>
      </div>
    </header>
  );
}
