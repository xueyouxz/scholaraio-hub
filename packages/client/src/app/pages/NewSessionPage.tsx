import { Settings } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../core/api";
import type { ModelInfo, ThinkingOption, UploadedFile } from "../../core/types";
import { useProjectScope } from "../components/NavigationLayout";
import { MessageInput } from "../session/components/MessageInput";

export function NewSessionPage() {
  const navigate = useNavigate();
  const { selectedProjectId, selectedProvider } = useProjectScope();
  const [message, setMessage] = useState("");
  const [thinking, setThinking] = useState<ThinkingOption>("auto");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!selectedProvider) return;
    api.getProviders().then((data) => {
      const provider = data.providers.find((p) => p.name === selectedProvider);
      if (provider?.models && provider.models.length > 0) {
        setModels(provider.models);
        setSelectedModel((prev) => prev ?? provider.models?.[0]?.id);
      }
    });
  }, [selectedProvider]);

  if (!selectedProjectId || !selectedProvider) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-10rem)] gap-4">
        <p className="text-sm text-on-surface-variant text-center max-w-xs">
          Select an agent and project in Settings before starting a session.
        </p>
        <Link
          to="/settings"
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-surface-container text-on-surface text-sm font-medium hover:bg-surface-container-high transition-colors"
        >
          <Settings className="w-4 h-4" />
          Go to Settings
        </Link>
      </div>
    );
  }

  const handleSend = async () => {
    if (!message.trim() && files.length === 0) return;
    setBusy(true);
    setError("");
    try {
      let attachments: UploadedFile[] = [];
      if (files.length > 0) {
        const created = await api.createSession({
          projectId: selectedProjectId,
          provider: selectedProvider,
        });
        attachments = await Promise.all(
          files.map((file) => api.uploadAttachment(selectedProjectId, created.sessionId, file)),
        );
        await api.resumeSession({
          projectId: selectedProjectId,
          sessionId: created.sessionId,
          provider: selectedProvider,
          thinking,
          model: selectedModel,
          message: message.trim(),
          attachments,
        });
        navigate(`/projects/${selectedProjectId}/sessions/${created.sessionId}`);
        return;
      }

      const started = await api.startSession({
        projectId: selectedProjectId,
        provider: selectedProvider,
        thinking,
        model: selectedModel,
        message: message.trim(),
      });
      navigate(`/projects/${selectedProjectId}/sessions/${started.sessionId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start session");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-end min-h-[calc(100vh-10rem)] pb-4">
      {error ? <p className="mb-4 text-sm text-error text-center">{error}</p> : null}
      <MessageInput
        message={message}
        thinking={thinking}
        busy={busy}
        files={files}
        model={selectedModel}
        models={models}
        onMessageChange={setMessage}
        onThinkingChange={setThinking}
        onFilesChange={setFiles}
        onModelChange={setSelectedModel}
        onSend={handleSend}
      />
    </div>
  );
}
