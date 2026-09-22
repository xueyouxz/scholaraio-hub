import type { ProviderName, SessionAttachment, StoredSession } from "@scholaraio-hub/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { usePageTitle } from "../../app/components/NavigationLayout";
import {
  type SessionOptions,
  libraryApi,
  sessionApi,
  settingsApi,
  skillsApi,
} from "../../core/library";
import { queryKeys } from "../../core/queryKeys";
import { useProviders } from "./composer/hooks/useProviders";
import { optionsForProvider } from "./composer/model/options";
import { Composer, readComposerDraft } from "./composer/ui/Composer";
import type { ComposerControls } from "./composer/ui/ComposerOptions";
import {
  describeCardinalityRequirement,
  filterReadingContextSkills,
  isSkillEnabledForSelection,
} from "./workspaceSkills";

/**
 * New chat (`/sessions`). Scope comes from the URL: `project` (set by the sidebar),
 * `papers` (paper chips / "询问本文") and `skill` (Skills → 插入到会话).
 */
export function NewSessionView() {
  const [params, setParams] = useSearchParams();
  const projectId = params.get("project") ?? "";
  const paperIds = [...new Set((params.get("papers") ?? "").split(",").filter(Boolean))];
  const skillName = params.get("skill") ?? "";
  const scopeKey = `${projectId}:${skillName}`;
  return (
    <NewSessionForm
      key={scopeKey}
      skillName={skillName}
      projectId={projectId}
      paperIds={paperIds}
      onPapersChange={(ids) => {
        const next = new URLSearchParams(params);
        if (ids.length) next.set("papers", ids.join(","));
        else next.delete("papers");
        setParams(next, { replace: true });
      }}
    />
  );
}

const PROMPT_SUGGESTIONS = [
  "解释这段代码的工作原理",
  "帮我审查最近的改动",
  "写一份技术方案文档",
  "分析这个问题并给出建议",
];

function NewSessionForm({
  skillName,
  projectId,
  paperIds,
  onPapersChange,
}: {
  skillName: string;
  projectId: string;
  paperIds: string[];
  onPapersChange: (ids: string[]) => void;
}) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const { setTitle } = usePageTitle();
  const defaults = useQuery({
    queryKey: ["app-settings"],
    queryFn: ({ signal }) => settingsApi.get(signal),
  });
  const providers = useProviders();
  const projects = useQuery({
    queryKey: ["library", "projects"],
    queryFn: ({ signal }) => libraryApi.projects(signal),
  });
  const project = projects.data?.projects.find((p) => p.id === projectId);
  const papers = useQuery({
    queryKey: ["library", "papers"],
    queryFn: ({ signal }) => libraryApi.papers(signal),
    enabled: paperIds.length > 0 || !!projectId,
  });
  const skills = useQuery({
    queryKey: queryKeys.scholaraioSkills(),
    queryFn: ({ signal }) => skillsApi.list(signal),
    enabled: !!project,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const readingSkills = useMemo(
    () => filterReadingContextSkills(skills.data?.skills ?? []),
    [skills.data],
  );
  const extraCommands = useMemo(
    () =>
      readingSkills.map((skill) => ({
        name: skill.name,
        description: skill.description,
        source: "research" as const,
      })),
    [readingSkills],
  );
  const draftKey = `new:${projectId}`;
  const [text, setText] = useState(() =>
    skillName ? `/${skillName} ` : readComposerDraft(draftKey),
  );
  const newSessionDefaults = defaults.data?.settings.newSessionDefaults;
  const [providerChoice, setProviderChoice] = useState<ProviderName>();
  const [choices, setChoices] = useState<SessionOptions>({});
  const provider: ProviderName =
    providerChoice ?? (newSessionDefaults?.provider === "codex" ? "codex" : "claude");
  // The settings' default model belongs to the settings' provider, until a model is picked.
  const options: SessionOptions = {
    ...choices,
    model:
      choices.model ??
      (provider === newSessionDefaults?.provider ? newSessionDefaults.model : undefined),
  };
  const model = options.model ?? "";
  const execution = {
    permissionMode: options.permissionMode,
    thinking: options.thinking,
    // "" means the provider default, which a new session gets by leaving it unset.
    effort: options.effort || undefined,
  };
  useEffect(() => {
    setTitle(project?.name ?? "New Chat");
    return () => setTitle("");
  }, [setTitle, project?.name]);
  const activeSkill = useMemo(() => {
    for (const skill of readingSkills) {
      const token = `/${skill.name}`;
      if (text === token || text.startsWith(`${token} `)) return skill.name;
    }
    return null;
  }, [text, readingSkills]);
  const toggleSkill = (name: string) => {
    const nextToken = `/${name}`;
    const activeToken = activeSkill ? `/${activeSkill}` : "";
    const body = !activeSkill
      ? text
      : text.startsWith(`${activeToken} `)
        ? text.slice(activeToken.length + 1)
        : text === activeToken
          ? ""
          : text;
    if (activeSkill === name) setText(body);
    else setText(body ? `${nextToken} ${body}` : `${nextToken} `);
  };
  /** Research skills receive the selected paper ids as their arguments. */
  const composePrompt = (message: string) => {
    const trimmed = message.trim();
    if (!activeSkill || paperIds.length === 0) return trimmed;
    const token = `/${activeSkill}`;
    if (trimmed === token) return `${token} ${paperIds.join(" ")}`;
    if (trimmed.startsWith(`${token} `))
      return `${token} ${paperIds.join(" ")} ${trimmed.slice(token.length + 1)}`;
    return trimmed;
  };
  // First send = create session + begin first turn, then navigate to it. If the
  // begin step fails, a retry with identical input reuses the created session and
  // message id instead of creating duplicates.
  const created = useRef<
    { signature: string; session: StoredSession; messageId: string } | undefined
  >(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string>();
  const start = async (message: string, attachments: SessionAttachment[] = []) => {
    const attachmentIds = attachments.map((file) => file.id);
    const composed = composePrompt(message);
    setSubmitting(true);
    setCreateError(undefined);
    try {
      const signature = JSON.stringify([
        projectId,
        paperIds,
        provider,
        model,
        execution,
        composed,
        attachmentIds,
      ]);
      if (created.current?.signature !== signature) {
        created.current = {
          signature,
          session: await sessionApi.create(
            provider,
            paperIds,
            model,
            projectId || undefined,
            execution,
            attachmentIds,
          ),
          messageId: crypto.randomUUID(),
        };
      }
      const { session, messageId } = created.current;
      if (composed || attachmentIds.length) {
        await sessionApi.begin(session.id, messageId, composed, attachmentIds);
      }
      void client.invalidateQueries({ queryKey: ["sessions"] });
      navigate(`/sessions/${session.id}`);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "创建会话失败");
      throw error;
    } finally {
      setSubmitting(false);
    }
  };
  const controls: ComposerControls = {
    provider,
    info: providers.find(provider),
    options,
    onChange: (patch) => setChoices((previous) => ({ ...previous, ...patch })),
    disabled: submitting,
    providers: providers.providers,
    onProviderChange: (next) => {
      if (next === provider) return;
      const nextInfo = providers.find(next);
      setProviderChoice(next);
      if (nextInfo) setChoices(optionsForProvider(nextInfo.capabilities, options));
    },
  };
  const invalidProject = !!projectId && !!projects.data && !project;
  const disabled =
    submitting ||
    defaults.isLoading ||
    !!defaults.error ||
    invalidProject ||
    projects.isLoading ||
    !!projects.error;
  const projectPapers =
    project && papers.data
      ? papers.data.papers.filter((paper) => project.paperIds.includes(paper.id))
      : [];
  const paperTitle = (id: string) => papers.data?.papers.find((p) => p.id === id)?.title ?? id;
  const togglePaper = (id: string) =>
    onPapersChange(paperIds.includes(id) ? paperIds.filter((p) => p !== id) : [...paperIds, id]);
  const error =
    (invalidProject ? "项目不存在，请重新选择。" : undefined) ??
    (defaults.error ?? projects.error ?? providers.error ?? papers.error)?.message ??
    createError;
  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {project ? (
        <div className="flex flex-col flex-1 min-h-0 w-full max-w-[830px] mx-auto px-2">
          <div className="flex-1 min-h-0 overflow-y-auto pt-6 pb-2">
            {papers.isLoading ? (
              <div className="px-1 text-xs text-on-surface-variant animate-pulse">加载中…</div>
            ) : projectPapers.length === 0 ? (
              <div className="px-1 text-xs text-on-surface-variant italic">该工作空间暂无文献</div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {projectPapers.map((paper) => {
                  const checked = paperIds.includes(paper.id);
                  return (
                    <button
                      key={paper.id}
                      type="button"
                      aria-pressed={checked}
                      disabled={submitting}
                      onClick={() => togglePaper(paper.id)}
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
          {paperIds.length > 0 ? (
            <div className="shrink-0 pt-2 pb-2">
              {skills.isLoading ? (
                <p className="text-xs text-on-surface-variant px-1">加载中…</p>
              ) : readingSkills.length === 0 ? null : (
                <div className="flex flex-wrap gap-1.5">
                  {readingSkills.map((skill) => {
                    const enabled = isSkillEnabledForSelection(skill.name, paperIds.length);
                    const reason = describeCardinalityRequirement(skill.name);
                    const active = activeSkill === skill.name;
                    return (
                      <button
                        key={skill.name}
                        type="button"
                        disabled={!enabled || submitting}
                        aria-pressed={active}
                        onClick={() => toggleSkill(skill.name)}
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
      ) : (
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
              {PROMPT_SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => setText(suggestion)}
                  className="px-3 py-1.5 rounded-lg text-sm text-on-surface-variant bg-surface-container hover:bg-surface-container-high transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      {error ? (
        <p role="alert" className="text-sm text-error text-center mb-2 px-4 break-words">
          {error}
        </p>
      ) : null}
      <div className="w-full max-w-[830px] mx-auto pb-[max(1rem,env(safe-area-inset-bottom))] px-2">
        {paperIds.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 mb-2 px-1">
            {paperIds.map((id) => (
              <span
                key={id}
                className="inline-flex items-center gap-1.5 max-w-[260px] px-2.5 py-1 rounded-lg text-xs bg-surface-container border border-outline-variant/20 text-on-surface-variant"
              >
                <span className="truncate" title={paperTitle(id)}>
                  {paperTitle(id)}
                </span>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => togglePaper(id)}
                  aria-label={`移除文献 ${paperTitle(id)}`}
                  className="text-on-surface-variant hover:text-error transition-colors shrink-0"
                >
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <Composer
          draftKey={draftKey}
          text={text}
          onTextChange={setText}
          disabled={disabled}
          provider={provider}
          extraCommands={extraCommands}
          onSend={start}
          controls={controls}
        />
      </div>
    </div>
  );
}
