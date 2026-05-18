import { Settings } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../core/api";
import type { ModelInfo, ThinkingOption, UploadedFile } from "../../core/types";
import { MessageInput } from "../../features/session/components/MessageInput";
import { usePageTitle, useProjectScope } from "../components/NavigationLayout";

const PROMPT_SUGGESTIONS = [
  "解释这段代码的工作原理",
  "帮我审查最近的改动",
  "写一份技术方案文档",
  "分析这个问题并给出建议",
];

export function NewSessionPage() {
  const navigate = useNavigate();
  const { setTitle } = usePageTitle();
  const { selectedProjectId, selectedProvider } = useProjectScope();
  const [message, setMessage] = useState("");
  const [thinking, setThinking] = useState<ThinkingOption>("auto");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState<string | undefined>(undefined);

  useEffect(() => {
    setTitle("New Chat");
    return () => setTitle("");
  }, [setTitle]);

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
      <div className="flex flex-col items-center justify-center flex-1 gap-5 py-20">
        <div className="text-center">
          <p className="font-serif text-xl font-semibold text-on-surface mb-1">准备好了吗？</p>
          <p className="text-sm text-on-surface-variant max-w-xs">
            先在 Settings 中选择 Agent 和 Project，然后就可以开始对话了。
          </p>
        </div>
        <Link
          to="/settings"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-surface-container text-on-surface text-sm font-medium hover:bg-surface-container-high transition-colors"
        >
          <Settings className="w-4 h-4" />
          前往 Settings
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
        const resumed = await api.resumeSession({
          projectId: selectedProjectId,
          sessionId: created.sessionId,
          provider: selectedProvider,
          thinking,
          model: selectedModel,
          message: message.trim(),
          attachments,
        });
        navigate(`/projects/${selectedProjectId}/sessions/${created.sessionId}`, {
          state: {
            initialOwnership: { owner: "self" as const, processId: resumed.processId },
            initialTitle: message.trim(),
          },
        });
        return;
      }

      const started = await api.startSession({
        projectId: selectedProjectId,
        provider: selectedProvider,
        thinking,
        model: selectedModel,
        message: message.trim(),
      });
      navigate(`/projects/${selectedProjectId}/sessions/${started.sessionId}`, {
        state: {
          initialOwnership: { owner: "self" as const, processId: started.processId },
          initialTitle: message.trim(),
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start session");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-center flex-1 justify-end pb-4 gap-8">
      {/* Welcome area — only shown when input is empty */}
      {!message && !busy ? (
        <div className="flex flex-col items-center gap-6 mb-4">
          <div className="text-center">
            <h2 className="font-serif text-3xl font-bold text-on-surface mb-1">
              有什么我可以帮你的？
            </h2>
            <p className="text-sm text-on-surface-variant">
              开始一段新对话，或从下方建议中选择一个。
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2 max-w-lg">
            {PROMPT_SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setMessage(s)}
                className="px-3 py-1.5 rounded-lg text-sm text-on-surface-variant bg-surface-container hover:bg-surface-container-high transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {error ? <p className="text-sm text-error text-center">{error}</p> : null}

      <div className="w-full max-w-[830px]">
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
    </div>
  );
}
