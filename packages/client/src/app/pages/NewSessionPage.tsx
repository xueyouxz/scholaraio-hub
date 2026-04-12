import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  DEFAULT_NEW_SESSION,
  PERMISSION_MODES,
  THINKING_OPTIONS,
  api,
  getProviderChoices,
} from "../../core/api";
import type {
  PermissionMode,
  ProjectSummary,
  ProviderInfo,
  ThinkingOption,
  UploadedFile,
} from "../../core/types";

export function NewSessionPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [settingsProvider, setSettingsProvider] = useState(
    DEFAULT_NEW_SESSION.provider ?? "claude",
  );
  const [projectId, setProjectId] = useState(params.get("projectId") ?? "");
  const [provider, setProvider] = useState(DEFAULT_NEW_SESSION.provider ?? "claude");
  const [model, setModel] = useState("");
  const [mode, setMode] = useState<PermissionMode>(DEFAULT_NEW_SESSION.permissionMode ?? "default");
  const [thinking, setThinking] = useState<ThinkingOption>("auto");
  const [message, setMessage] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const [projectData, providerData, settingsData] = await Promise.all([
          api.getProjects(),
          api.getProviders(),
          api.getSettings(),
        ]);
        setProjects(projectData.projects);
        setProviders(getProviderChoices(providerData.providers));
        const defaults = settingsData.settings?.newSessionDefaults;
        const nextProjectId = projectId || projectData.projects[0]?.id || "";
        setProjectId(nextProjectId);
        setSettingsProvider(defaults?.provider ?? "claude");
        setProvider(defaults?.provider ?? "claude");
        setModel(defaults?.model ?? "");
        setMode(defaults?.permissionMode ?? "default");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load form data");
      }
    })();
  }, [projectId]);

  const currentProvider = useMemo(
    () => providers.find((item) => item.name === provider) ?? null,
    [provider, providers],
  );

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!projectId || !message.trim()) return;
    setBusy(true);
    setError("");
    try {
      let attachments: UploadedFile[] = [];
      if (files.length > 0) {
        const created = await api.createSession({ projectId, provider, model, mode, thinking });
        attachments = await Promise.all(
          files.map((file) => api.uploadAttachment(projectId, created.sessionId, file)),
        );
        await api.resumeSession({
          projectId,
          sessionId: created.sessionId,
          provider,
          model,
          mode,
          thinking,
          message: message.trim(),
          attachments,
        });
        navigate(`/projects/${projectId}/sessions/${created.sessionId}`);
        return;
      }

      const started = await api.startSession({
        projectId,
        provider,
        model,
        mode,
        thinking,
        message: message.trim(),
      });
      navigate(`/projects/${projectId}/sessions/${started.sessionId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start session");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel">
      <div className="panel-header">
        <h2 className="title">New Session</h2>
      </div>
      <div className="panel-body">
        <form className="stack" onSubmit={submit}>
          <div className="grid-two">
            <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name ?? project.path}
                </option>
              ))}
            </select>
            <select
              value={provider}
              onChange={(event) => setProvider(event.target.value as typeof provider)}
            >
              {providers.map((item) => (
                <option key={item.name} value={item.name}>
                  {item.displayName}
                </option>
              ))}
            </select>
          </div>
          <div className="grid-two">
            <select value={model} onChange={(event) => setModel(event.target.value)}>
              <option value="">Default model</option>
              {(currentProvider?.models ?? []).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <select
              value={mode}
              onChange={(event) => setMode(event.target.value as PermissionMode)}
            >
              {PERMISSION_MODES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>
          <select
            value={thinking}
            onChange={(event) => setThinking(event.target.value as ThinkingOption)}
          >
            {THINKING_OPTIONS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Describe what you want to work on…"
          />
          <input
            type="file"
            multiple
            onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
          />
          {files.length > 0 ? (
            <div className="muted">{files.length} attachments selected</div>
          ) : null}
          {settingsProvider !== provider ? (
            <div className="muted">Server default provider is {settingsProvider}.</div>
          ) : null}
          {error ? <div className="empty">{error}</div> : null}
          <div className="toolbar">
            <button type="submit" className="primary" disabled={busy}>
              {busy ? "Starting…" : "Start Session"}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
