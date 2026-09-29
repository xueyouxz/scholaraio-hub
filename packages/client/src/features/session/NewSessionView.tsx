import {
  DEFAULT_PROVIDER,
  type LiteratureRef,
  type ProviderName,
  type SessionAttachment,
} from "@scholaraio-hub/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { usePageTitle } from "../../app/components/NavigationLayout";
import { PROJECTS_KEY, addChosenFolder, projectsQuery } from "../../core/projects";
import {
  type SessionOptions,
  formatReferences,
  newSessionUrl,
  parseReferences,
  sessionApi,
  sessionUrl,
} from "../../core/sessions";
import { appSettingsQuery } from "../../core/settings";
import { skillsQuery } from "../../core/skills";
import { ProjectPicker } from "./components/ProjectPicker";
import { ReferenceChips } from "./components/ReferenceChips";
import { useProviders } from "./composer/hooks/useProviders";
import { initialOptions, optionsForProvider } from "./composer/model/options";
import { readComposerPreference, rememberComposerChoice } from "./composer/model/preferences";
import { Composer, readComposerDraft } from "./composer/ui/Composer";
import type { ComposerControls } from "./composer/ui/ComposerOptions";
import {
  describeCardinalityRequirement,
  filterReadingContextSkills,
  isSkillEnabledForSelection,
} from "./workspaceSkills";

/**
 * New chat (`/sessions`). Everything it starts from is in the URL: `project`
 * (the project it runs in), `refs` (the literature it refers to, as the
 * library's "ask" links set it) and `skill` (Skills → 插入到会话).
 */
export function NewSessionView() {
  const [params, setParams] = useSearchParams();
  const projectId = params.get("project") ?? "";
  const references = parseReferences(params.get("refs"));
  const skillName = params.get("skill") ?? "";
  return (
    <NewSessionForm
      key={`${projectId}:${skillName}`}
      skillName={skillName}
      projectId={projectId}
      references={references}
      onReferencesChange={(next) => {
        const updated = new URLSearchParams(params);
        if (next.length) updated.set("refs", formatReferences(next));
        else updated.delete("refs");
        setParams(updated, { replace: true });
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
  references,
  onReferencesChange,
}: {
  skillName: string;
  projectId: string;
  references: LiteratureRef[];
  onReferencesChange: (references: LiteratureRef[]) => void;
}) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const { setTitle } = usePageTitle();
  const defaults = useQuery({ ...appSettingsQuery });
  const providers = useProviders();
  const projects = useQuery(projectsQuery);
  const project = projects.data?.projects.find((item) => item.id === projectId);
  const paperIds = references.flatMap((ref) => (ref.kind === "paper" ? [ref.id] : []));
  const skills = useQuery({ ...skillsQuery, enabled: paperIds.length > 0 });
  const readingSkills = useMemo(
    () => filterReadingContextSkills(skills.data?.skills ?? []),
    [skills.data],
  );
  const draftKey = `new:${projectId}`;
  const [text, setText] = useState(() =>
    skillName ? `/${skillName} ` : readComposerDraft(draftKey),
  );
  const newSessionDefaults = defaults.data?.settings.newSessionDefaults;
  const [providerChoice, setProviderChoice] = useState<ProviderName>();
  const [choices, setChoices] = useState<SessionOptions>({});
  const provider: ProviderName = providerChoice ?? newSessionDefaults?.provider ?? DEFAULT_PROVIDER;
  const info = providers.find(provider);
  // Until the user picks, a new chat opens on its last choices for this agent
  // (the server settings' model counts as one), else the provider's own defaults.
  const remembered = {
    ...readComposerPreference(provider),
    ...(provider === newSessionDefaults?.provider && newSessionDefaults.model
      ? { model: newSessionDefaults.model }
      : {}),
  };
  const options: SessionOptions = {
    ...(info ? initialOptions(info.capabilities, info.models ?? [], remembered) : {}),
    ...choices,
  };
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
  /** Research skills receive the referred papers' ids as their arguments. */
  const composePrompt = (message: string) => {
    const trimmed = message.trim();
    if (!activeSkill || paperIds.length === 0) return trimmed;
    const token = `/${activeSkill}`;
    if (trimmed === token) return `${token} ${paperIds.join(" ")}`;
    if (trimmed.startsWith(`${token} `))
      return `${token} ${paperIds.join(" ")} ${trimmed.slice(token.length + 1)}`;
    return trimmed;
  };
  // A retry of the same message keeps its id, so the server can tell it apart
  // from a second message.
  const attempt = useRef<{ signature: string; messageId: string } | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string>();
  const start = async (message: string, attachments: SessionAttachment[] = []) => {
    const attachmentIds = attachments.map((file) => file.id);
    const composed = composePrompt(message);
    const signature = JSON.stringify([composed, attachmentIds]);
    if (attempt.current?.signature !== signature)
      attempt.current = { signature, messageId: crypto.randomUUID() };
    setSubmitting(true);
    setCreateError(undefined);
    try {
      const session = await sessionApi.create({
        provider,
        ...(options.model ? { model: options.model } : {}),
        ...execution,
        ...(project ? { cwd: project.path } : {}),
        references,
        message: { id: attempt.current.messageId, text: composed, attachmentIds, references: [] },
      });
      void client.invalidateQueries({ queryKey: PROJECTS_KEY });
      navigate(sessionUrl(session.id));
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "创建会话失败");
      throw error;
    } finally {
      setSubmitting(false);
    }
  };
  const chooseProject = (id: string) =>
    navigate(
      newSessionUrl({ project: id || undefined, references, skill: skillName || undefined }),
      {
        replace: true,
      },
    );
  const addProject = useMutation({
    mutationFn: addChosenFolder,
    onSuccess: (added) => {
      if (!added) return;
      void client.invalidateQueries({ queryKey: PROJECTS_KEY });
      chooseProject(added.id);
    },
  });
  const controls: ComposerControls = {
    provider,
    info,
    options,
    onChange: (patch) => {
      rememberComposerChoice(provider, patch);
      setChoices((previous) => ({ ...previous, ...patch }));
    },
    disabled: submitting,
    providers: providers.providers,
    onProviderChange: (next) => {
      if (next === provider) return;
      const nextInfo = providers.find(next);
      setProviderChoice(next);
      setChoices(
        nextInfo
          ? optionsForProvider(
              nextInfo.capabilities,
              nextInfo.models ?? [],
              options,
              readComposerPreference(next),
            )
          : {},
      );
    },
  };
  const invalidProject = !!projectId && !!projects.data && !project;
  const disabled =
    submitting || defaults.isLoading || !!defaults.error || invalidProject || projects.isLoading;
  const error =
    (invalidProject ? "项目不存在，请重新选择。" : undefined) ??
    (defaults.error ?? projects.error ?? providers.error ?? addProject.error)?.message ??
    createError;
  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Centred in the space above the composer, and lifted a little: the eye
          settles above the middle, and the composer below keeps the weight. */}
      <div className="flex flex-col items-center flex-1 justify-center pb-[10vh] gap-8 px-4">
        <div className="flex flex-col items-center gap-6">
          <div className="text-center">
            <h2 className="font-serif text-3xl font-bold text-on-surface mb-1">
              有什么我可以帮你的？
            </h2>
            <p className="text-sm text-on-surface-variant">
              {project
                ? `在 ${project.name} 中开始一段新对话。`
                : "开始一段新对话，或从下方建议中选择一个。"}
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
      {error ? (
        <p role="alert" className="text-sm text-error text-center mb-2 px-4 break-words">
          {error}
        </p>
      ) : null}
      <div className="w-full max-w-[830px] mx-auto pb-[max(1rem,env(safe-area-inset-bottom))] px-2">
        {paperIds.length > 0 && readingSkills.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 mb-2 px-1">
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
        ) : null}
        <div className="flex flex-wrap items-center gap-1.5 mb-2 px-1">
          <ProjectPicker
            projects={projects.data?.projects ?? []}
            current={project}
            disabled={submitting || projects.isLoading}
            onChange={chooseProject}
            onAdd={() => addProject.mutate()}
            adding={addProject.isPending}
          />
          <ReferenceChips
            references={references}
            disabled={submitting}
            onRemove={(removed) =>
              onReferencesChange(
                references.filter((item) => item.kind !== removed.kind || item.id !== removed.id),
              )
            }
          />
        </div>
        <Composer
          draftKey={draftKey}
          text={text}
          onTextChange={setText}
          disabled={disabled}
          provider={provider}
          cwd={project?.path}
          onReference={(ref) => {
            if (!references.some((item) => item.kind === ref.kind && item.id === ref.id))
              onReferencesChange([...references, ref]);
          }}
          onSend={start}
          controls={controls}
        />
      </div>
    </div>
  );
}
