import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, messageText, providerLabel } from "../../core/api";
import type { ProcessSummary, SessionDetail, ThinkingOption, UploadedFile } from "../../core/types";

export function SessionPage() {
  const { projectId = "", sessionId = "" } = useParams();
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [message, setMessage] = useState("");
  const [thinking, setThinking] = useState<ThinkingOption>("auto");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [processes, setProcesses] = useState<ProcessSummary[]>([]);
  const eventSourceRef = useRef<EventSource | null>(null);

  const load = useCallback(
    async (beforeMessageId?: string) => {
      const data = await api.getSession(projectId, sessionId, {
        tailCompactions: beforeMessageId ? 1 : 2,
        beforeMessageId,
      });
      setDetail((current) => {
        if (!beforeMessageId || !current?.pagination) return data;
        return {
          ...data,
          messages: [...data.messages, ...current.messages],
        };
      });
    },
    [projectId, sessionId],
  );

  const loadProcesses = useCallback(async () => {
    const data = await api.getProcesses();
    setProcesses([...(data.processes ?? []), ...(data.terminatedProcesses ?? [])]);
  }, []);

  useEffect(() => {
    void load().catch((err) =>
      setError(err instanceof Error ? err.message : "Failed to load session"),
    );
    void loadProcesses();
  }, [load, loadProcesses]);

  useEffect(() => {
    if (!sessionId) return;
    const source = new EventSource(`/api/sessions/${sessionId}/stream`);
    const refresh = () => {
      void load().catch(() => {});
      void loadProcesses().catch(() => {});
    };
    source.addEventListener("message", refresh);
    source.addEventListener("status", refresh);
    source.addEventListener("complete", refresh);
    source.onerror = () => {
      source.close();
    };
    eventSourceRef.current = source;
    return () => source.close();
  }, [load, loadProcesses, sessionId]);

  const process = useMemo(
    () => processes.find((item) => item.sessionId === sessionId) ?? null,
    [processes, sessionId],
  );

  const send = async () => {
    if (!detail || (!message.trim() && files.length === 0)) return;
    setBusy(true);
    setError("");
    try {
      let attachments: UploadedFile[] = [];
      if (files.length > 0) {
        attachments = await Promise.all(
          files.map((file) => api.uploadAttachment(projectId, sessionId, file)),
        );
      }
      if (detail.ownership.owner === "self") {
        await api.queueMessage({ sessionId, message: message.trim(), thinking, attachments });
      } else {
        await api.resumeSession({
          projectId,
          sessionId,
          message: message.trim(),
          thinking,
          attachments,
        });
      }
      setMessage("");
      setFiles([]);
      await load();
      await loadProcesses();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setBusy(false);
    }
  };

  const loadOlder = async () => {
    if (!detail?.pagination?.truncatedBeforeMessageId) return;
    await load(detail.pagination.truncatedBeforeMessageId);
  };

  const title = detail?.session.customTitle ?? detail?.session.title ?? sessionId;
  const pendingInputRequest = detail?.pendingInputRequest ?? null;

  const respondToPendingInput = (response: "approve" | "approve_accept_edits" | "deny") => {
    if (!pendingInputRequest) return;
    return api.respondToInput(sessionId, pendingInputRequest.id, response).then(() => load());
  };

  return (
    <>
      <div className="panel-header">
        <div className="toolbar">
          <Link to={`/sessions?project=${projectId}`} className="button">
            Back
          </Link>
          <h2 className="title">{title}</h2>
        </div>
      </div>
      <div className="panel-body stack">
        {detail ? (
          <div className="inline-meta">
            <span>{providerLabel(detail.session.provider)}</span>
            <span>{detail.session.model ?? "default model"}</span>
            <span>{detail.session.ownership.owner}</span>
            {process ? (
              <span>{typeof process.state === "string" ? process.state : process.state?.type}</span>
            ) : null}
          </div>
        ) : null}
        {pendingInputRequest ? (
          <div className="message">
            <strong>Pending Input:</strong> {pendingInputRequest.toolName}
            <div className="toolbar" style={{ marginTop: "0.75rem" }}>
              <button type="button" onClick={() => void respondToPendingInput("approve")}>
                Approve
              </button>
              <button
                type="button"
                onClick={() => void respondToPendingInput("approve_accept_edits")}
              >
                Approve + Accept Edits
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => void respondToPendingInput("deny")}
              >
                Deny
              </button>
            </div>
          </div>
        ) : null}
        {error ? <div className="empty">{error}</div> : null}
        {detail?.pagination?.hasOlderMessages ? (
          <button type="button" className="ghost" onClick={() => void loadOlder()}>
            Load older messages
          </button>
        ) : null}
        <div className="conversation">
          {detail?.messages.map((entry) => (
            <article
              key={String(entry.id ?? entry.uuid ?? Math.random())}
              className={`message ${entry.type === "user" ? "user" : "assistant"}`}
            >
              <div className="inline-meta">
                <span>{entry.type}</span>
                {"timestamp" in entry && typeof entry.timestamp === "string" ? (
                  <span>{new Date(entry.timestamp).toLocaleString()}</span>
                ) : null}
              </div>
              <pre>{messageText(entry.content)}</pre>
            </article>
          ))}
        </div>
        <div className="stack">
          <select
            value={thinking}
            onChange={(event) => setThinking(event.target.value as ThinkingOption)}
          >
            <option value="off">off</option>
            <option value="auto">auto</option>
            <option value="on:medium">on:medium</option>
            <option value="on:high">on:high</option>
          </select>
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Continue the session…"
          />
          <input
            type="file"
            multiple
            onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
          />
          <div className="toolbar">
            <button type="button" className="primary" disabled={busy} onClick={() => void send()}>
              {busy ? "Sending…" : "Send"}
            </button>
            {process ? (
              <>
                <button
                  type="button"
                  onClick={() => void api.interruptProcess(process.id).then(() => loadProcesses())}
                >
                  Interrupt
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={() => void api.abortProcess(process.id).then(() => loadProcesses())}
                >
                  Abort
                </button>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}
