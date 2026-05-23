import { useQuery } from "@tanstack/react-query";
import { Settings } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../core/api";
import { queryKeys } from "../../core/queryKeys";
import type { SessionCreationResult, ThinkingOption } from "../../core/types";
import { MessageInput } from "../../features/session/components/MessageInput";
import { useAttachmentUploads } from "../../features/session/hooks/useAttachmentUploads";
import type { SessionNavState } from "../../features/session/types";
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selectedModel, setSelectedModel] = useState<string | undefined>(undefined);
  const [createdSession, setCreatedSession] = useState<SessionCreationResult | null>(null);

  useEffect(() => {
    setTitle("New Chat");
    return () => setTitle("");
  }, [setTitle]);

  const providersQuery = useQuery({
    queryKey: queryKeys.providers(),
    queryFn: ({ signal }) => api.getProviders({ signal }),
    select: (data) => data.providers,
    staleTime: 5 * 60_000,
  });

  const provider = useMemo(
    () => providersQuery.data?.find((p) => p.name === selectedProvider),
    [providersQuery.data, selectedProvider],
  );
  const models = provider?.models ?? [];
  const supportsPermissionMode = provider?.supportsPermissionMode ?? true;
  const supportsThinkingToggle = provider?.supportsThinkingToggle ?? true;

  useEffect(() => {
    if (models.length > 0) {
      setSelectedModel((prev) => prev ?? models[0]?.id);
    }
  }, [models]);

  const skillsQuery = useQuery({
    queryKey: queryKeys.projectSkills(selectedProjectId ?? "", selectedProvider ?? null),
    queryFn: ({ signal }) => {
      if (!selectedProjectId || !selectedProvider) {
        throw new Error("Missing project or provider");
      }
      return api.getProjectSkills(selectedProjectId, selectedProvider, { signal });
    },
    enabled: !!selectedProjectId && !!selectedProvider,
    select: (data) => data.slashCommands,
  });
  const slashCommands = skillsQuery.data ?? [];

  const ensureUploadSessionId = useCallback(async () => {
    if (createdSession) return createdSession.sessionId;
    if (!selectedProjectId || !selectedProvider) {
      throw new Error("Select a project and provider before uploading files");
    }
    const created = await api.createSession({
      projectId: selectedProjectId,
      provider: selectedProvider,
      thinking,
      model: selectedModel,
    });
    setCreatedSession(created);
    return created.sessionId;
  }, [createdSession, selectedModel, selectedProjectId, selectedProvider, thinking]);

  const attachmentUploads = useAttachmentUploads({
    projectId: selectedProjectId ?? "",
    sessionId: createdSession?.sessionId,
    ensureSessionId: ensureUploadSessionId,
    onUploadError: (failure) => {
      setError(`${failure.fileName}: ${failure.message}`);
    },
  });

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

  const handleSend = async (finalMessage: string) => {
    const trimmed = finalMessage.trim();
    if (!trimmed && !attachmentUploads.hasAttachments) return;
    setBusy(true);
    setError("");
    try {
      if (attachmentUploads.hasAttachments) {
        const sessionId = createdSession?.sessionId ?? (await ensureUploadSessionId());
        const attachments = await attachmentUploads.waitForUploads();
        attachmentUploads.clearAttachments();
        const resumed = await api.resumeSession({
          projectId: selectedProjectId,
          sessionId,
          provider: selectedProvider,
          thinking,
          model: selectedModel,
          message: trimmed,
          attachments,
        });
        navigate(`/projects/${selectedProjectId}/sessions/${sessionId}`, {
          state: {
            initialStatus: { owner: "self" as const, processId: resumed.processId },
            initialTitle: trimmed,
            initialProvider: selectedProvider,
            initialModel: selectedModel,
          } satisfies SessionNavState,
        });
        return;
      }

      const started = await api.startSession({
        projectId: selectedProjectId,
        provider: selectedProvider,
        thinking,
        model: selectedModel,
        message: trimmed,
      });
      navigate(`/projects/${selectedProjectId}/sessions/${started.sessionId}`, {
        state: {
          initialStatus: { owner: "self" as const, processId: started.processId },
          initialTitle: trimmed,
          initialProvider: selectedProvider,
          initialModel: selectedModel,
        } satisfies SessionNavState,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start session");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-center flex-1 justify-end pb-4 gap-8">
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

      {error ? <p className="text-sm text-error text-center">{error}</p> : null}

      <div className="w-full max-w-[830px]">
        <MessageInput
          message={message}
          thinking={thinking}
          busy={busy}
          attachments={attachmentUploads.attachments}
          uploadProgress={attachmentUploads.uploadProgress}
          model={selectedModel}
          models={models}
          slashCommands={slashCommands}
          onMessageChange={setMessage}
          onThinkingChange={setThinking}
          onAttachFiles={attachmentUploads.addFiles}
          onRemoveAttachment={attachmentUploads.removeAttachment}
          onModelChange={setSelectedModel}
          onSend={handleSend}
          supportsPermissionMode={supportsPermissionMode}
          supportsThinkingToggle={supportsThinkingToggle}
        />
      </div>
    </div>
  );
}
