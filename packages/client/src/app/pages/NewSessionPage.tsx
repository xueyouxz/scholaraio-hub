import { toUrlProjectId } from "@scholaraio-hub/shared";
import { useQuery } from "@tanstack/react-query";
import { Settings, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, scholar } from "../../core/api";
import { queryKeys } from "../../core/queryKeys";
import type { SessionCreationResult, ThinkingOption } from "../../core/types";
import { MessageInput } from "../../features/session/components/MessageInput";
import { useAttachmentUploads } from "../../features/session/hooks/useAttachmentUploads";
import type { SessionNavState } from "../../features/session/types";
import {
  describeCardinalityRequirement,
  filterReadingContextSkills,
  isSkillEnabledForSelection,
} from "../../features/session/workspaceSkills";
import { usePageTitle, useProjectScope } from "../components/NavigationLayout";

const PROMPT_SUGGESTIONS = [
  "解释这段代码的工作原理",
  "帮我审查最近的改动",
  "写一份技术方案文档",
  "分析这个问题并给出建议",
];

interface PaperRef {
  id: string;
  title: string;
}

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

  // Selected papers are removable badges above MessageInput. The active skill
  // lives as a slash-prefix inside `message` and renders as the standard
  // SlashCommandBadge inside MessageInput (no separate state).
  const [selectedPapers, setSelectedPapers] = useState<PaperRef[]>([]);

  // ─── Workspace context detection ─────────────────────────────────────────
  const workspacesQuery = useQuery({
    queryKey: queryKeys.scholar.workspaces(),
    queryFn: ({ signal }) => scholar.getWorkspaces({ signal }),
    select: (data) => data.workspaces,
    staleTime: 5 * 60_000,
  });
  const workspace = useMemo(() => {
    if (!selectedProjectId) return null;
    return workspacesQuery.data?.find((w) => toUrlProjectId(w.path) === selectedProjectId) ?? null;
  }, [workspacesQuery.data, selectedProjectId]);
  const isWorkspaceContext = workspace !== null;
  const workspaceName = workspace?.name;

  // Reset context badges whenever the workspace identity changes.
  useEffect(() => {
    if (workspaceName !== undefined) {
      setSelectedPapers([]);
      setMessage("");
    }
  }, [workspaceName]);

  // ─── Workspace papers ───────────────────────────────────────────────────
  const workspacePapersQuery = useQuery({
    queryKey: queryKeys.scholar.workspace(workspaceName ?? ""),
    queryFn: ({ signal }) => scholar.getWorkspace(workspaceName ?? "", { signal }),
    enabled: !!workspaceName,
    select: (data) => data.workspace,
    staleTime: 30_000,
  });
  const papers = workspacePapersQuery.data?.papers ?? [];

  // ─── Skills for chip pool ────────────────────────────────────────────────
  const scholaraioSkillsQuery = useQuery({
    queryKey: queryKeys.scholaraioSkills(),
    queryFn: ({ signal }) => api.listScholaraioSkills({ signal }),
    enabled: isWorkspaceContext,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const readingSkills = useMemo(
    () => filterReadingContextSkills(scholaraioSkillsQuery.data?.skills ?? []),
    [scholaraioSkillsQuery.data],
  );

  useEffect(() => {
    setTitle(workspaceName ?? "New Chat");
    return () => setTitle("");
  }, [setTitle, workspaceName]);

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

  // Active skill is whichever reading-skill prefix the message currently carries.
  const activeSkill = useMemo(() => {
    for (const s of readingSkills) {
      const token = `/${s.name}`;
      if (message === token || message.startsWith(`${token} `)) return s.name;
    }
    return null;
  }, [message, readingSkills]);

  // Augment slashCommands so MessageInput's slash picker recognises reading
  // skills and renders the standard SlashCommandBadge for them.
  const augmentedSlashCommands = useMemo(() => {
    if (!isWorkspaceContext) return slashCommands;
    const existing = new Set(slashCommands.map((c) => c.name));
    const extras = readingSkills
      .filter((s) => !existing.has(s.name))
      .map((s) => ({ name: s.name, description: s.description, source: "research" as const }));
    return [...slashCommands, ...extras];
  }, [slashCommands, readingSkills, isWorkspaceContext]);

  /** Inject paper uuids on the skill line and/or append a paper context block. */
  const composePrompt = (finalMessage: string): string => {
    const trimmed = finalMessage.trim();
    const paperIds = selectedPapers.map((p) => p.id);
    if (paperIds.length === 0) return trimmed;
    if (activeSkill) {
      const token = `/${activeSkill}`;
      if (trimmed === token) return `${token} ${paperIds.join(" ")}`;
      if (trimmed.startsWith(`${token} `)) {
        const body = trimmed.slice(token.length + 1);
        return `${token} ${paperIds.join(" ")} ${body}`;
      }
    }
    const block = selectedPapers.map((p) => `- ${p.title} (id: ${p.id})`).join("\n");
    return trimmed ? `${trimmed}\n\n[相关文献]\n${block}` : `[相关文献]\n${block}`;
  };

  const hasPaperContext = selectedPapers.length > 0;

  const handleSend = async (finalMessage: string) => {
    const composed = composePrompt(finalMessage);
    if (!composed && !attachmentUploads.hasAttachments) return;
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
          message: composed,
          attachments,
        });
        navigate(`/projects/${selectedProjectId}/sessions/${sessionId}`, {
          state: {
            initialStatus: { owner: "self" as const, processId: resumed.processId },
            initialTitle: finalMessage.trim() || composed.split("\n")[0],
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
        message: composed,
      });
      navigate(`/projects/${selectedProjectId}/sessions/${started.sessionId}`, {
        state: {
          initialStatus: { owner: "self" as const, processId: started.processId },
          initialTitle: finalMessage.trim() || composed.split("\n")[0],
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

  const togglePaper = (paper: PaperRef) => {
    setSelectedPapers((prev) =>
      prev.some((p) => p.id === paper.id)
        ? prev.filter((p) => p.id !== paper.id)
        : [...prev, paper],
    );
  };
  const removePaper = (paperId: string) =>
    setSelectedPapers((prev) => prev.filter((p) => p.id !== paperId));

  /**
   * Toggle a skill prefix on the current message. Sets `/<skill> ` so the
   * existing slash picker hides the prefix and renders SlashCommandBadge.
   */
  const toggleSkill = (skillName: string) => {
    const newToken = `/${skillName}`;
    if (activeSkill) {
      const activeToken = `/${activeSkill}`;
      const body = message.startsWith(`${activeToken} `)
        ? message.slice(activeToken.length + 1)
        : message === activeToken
          ? ""
          : message;
      if (activeSkill === skillName) {
        setMessage(body);
        return;
      }
      setMessage(body ? `${newToken} ${body}` : `${newToken} `);
      return;
    }
    setMessage(message ? `${newToken} ${message}` : `${newToken} `);
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {isWorkspaceContext ? (
        <WorkspaceChips
          papers={papers}
          papersLoading={workspacePapersQuery.isLoading}
          papersError={
            workspacePapersQuery.error instanceof Error
              ? workspacePapersQuery.error.message
              : workspacePapersQuery.error
                ? "加载失败"
                : null
          }
          selectedPaperIds={new Set(selectedPapers.map((p) => p.id))}
          onTogglePaper={togglePaper}
          readingSkills={readingSkills}
          skillsLoading={scholaraioSkillsQuery.isLoading}
          activeSkill={activeSkill}
          onToggleSkill={toggleSkill}
          selectedPaperCount={selectedPapers.length}
        />
      ) : (
        <DefaultPrompts onPickPrompt={setMessage} />
      )}

      {error ? <p className="text-sm text-error text-center mb-2">{error}</p> : null}

      <div className="w-full max-w-[830px] mx-auto pb-4 px-2">
        {hasPaperContext ? (
          <ContextBadges papers={selectedPapers} onRemovePaper={removePaper} />
        ) : null}
        <MessageInput
          message={message}
          thinking={thinking}
          busy={busy}
          attachments={attachmentUploads.attachments}
          uploadProgress={attachmentUploads.uploadProgress}
          model={selectedModel}
          models={models}
          slashCommands={augmentedSlashCommands}
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

// ─── Default prompts (non-workspace) ────────────────────────────────────────

function DefaultPrompts({ onPickPrompt }: { onPickPrompt: (prompt: string) => void }) {
  return (
    <div className="flex flex-col items-center flex-1 justify-end gap-8">
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
              onClick={() => onPickPrompt(s)}
              className="px-3 py-1.5 rounded-lg text-sm text-on-surface-variant bg-surface-container hover:bg-surface-container-high transition-colors"
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Workspace chip groups (papers + skills) ────────────────────────────────

interface WorkspaceChipsProps {
  papers: Array<{ id: string; title: string }>;
  papersLoading: boolean;
  papersError: string | null;
  selectedPaperIds: Set<string>;
  onTogglePaper: (paper: PaperRef) => void;
  readingSkills: Array<{ name: string; description: string; category: string }>;
  skillsLoading: boolean;
  activeSkill: string | null;
  onToggleSkill: (skillName: string) => void;
  selectedPaperCount: number;
}

function WorkspaceChips({
  papers,
  papersLoading,
  papersError,
  selectedPaperIds,
  onTogglePaper,
  readingSkills,
  skillsLoading,
  activeSkill,
  onToggleSkill,
  selectedPaperCount,
}: WorkspaceChipsProps) {
  return (
    <div className="flex flex-col flex-1 min-h-0 w-full max-w-[830px] mx-auto px-2">
      {/* Paper chips */}
      <div className="flex-1 min-h-0 overflow-y-auto pt-6 pb-2">
        {papersLoading ? (
          <div className="px-1 text-xs text-on-surface-variant animate-pulse">加载中…</div>
        ) : papersError ? (
          <div className="px-1 text-xs text-error">{papersError}</div>
        ) : papers.length === 0 ? (
          <div className="px-1 text-xs text-on-surface-variant italic">该工作空间暂无文献</div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {papers.map((paper) => {
              const checked = selectedPaperIds.has(paper.id);
              return (
                <button
                  key={paper.id}
                  type="button"
                  onClick={() => onTogglePaper({ id: paper.id, title: paper.title })}
                  title={paper.title}
                  className={`max-w-full px-3 py-1 rounded-full text-xs transition-colors truncate ${
                    checked
                      ? "bg-primary/15 text-on-surface"
                      : "bg-surface-container text-on-surface-variant hover:bg-surface-container-high"
                  }`}
                >
                  {paper.title}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Skill chips — render only after at least one paper is selected */}
      {selectedPaperCount > 0 ? (
        <div className="shrink-0 pt-2 pb-2">
          {skillsLoading ? (
            <p className="text-xs text-on-surface-variant px-1">加载中…</p>
          ) : readingSkills.length === 0 ? null : (
            <div className="flex flex-wrap gap-1.5">
              {readingSkills.map((skill) => {
                const enabled = isSkillEnabledForSelection(skill.name, selectedPaperCount);
                const reason = describeCardinalityRequirement(skill.name);
                const active = activeSkill === skill.name;
                return (
                  <button
                    key={skill.name}
                    type="button"
                    disabled={!enabled}
                    onClick={() => onToggleSkill(skill.name)}
                    title={enabled ? skill.description : `${reason} · ${skill.description}`}
                    className={`px-2.5 py-1 rounded-full text-xs font-mono transition-colors ${
                      active
                        ? "bg-primary/15 text-on-surface"
                        : enabled
                          ? "bg-surface-container text-on-surface hover:bg-surface-container-high"
                          : "bg-surface-container/50 text-on-surface-variant/40 cursor-not-allowed"
                    }`}
                  >
                    /{skill.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

// ─── Context badges (above MessageInput) ────────────────────────────────────

interface ContextBadgesProps {
  papers: PaperRef[];
  onRemovePaper: (paperId: string) => void;
}

function ContextBadges({ papers, onRemovePaper }: ContextBadgesProps) {
  return (
    <div className="flex flex-wrap gap-1.5 mb-2 px-1">
      {papers.map((paper) => (
        <span
          key={paper.id}
          className="inline-flex items-center gap-1.5 max-w-[260px] px-2.5 py-1 rounded-lg text-xs bg-surface-container border border-outline-variant/20 text-on-surface-variant"
        >
          <span className="truncate" title={paper.title}>
            {paper.title}
          </span>
          <button
            type="button"
            onClick={() => onRemovePaper(paper.id)}
            aria-label={`移除文献 ${paper.title}`}
            className="text-on-surface-variant hover:text-error transition-colors shrink-0"
          >
            <X size={11} />
          </button>
        </span>
      ))}
    </div>
  );
}
