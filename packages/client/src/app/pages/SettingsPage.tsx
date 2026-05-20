import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowDownToLine,
  Bot,
  Brain,
  CheckCircle2,
  ChevronDown,
  Cpu,
  FolderKanban,
  FolderOpen,
  Globe,
  HardDrive,
  KeyRound,
  Layers,
  Link,
  RefreshCw,
  Save,
  Server,
  Sparkles,
  Wifi,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { type ScholarConfig, api, scholar } from "../../core/api";
import { queryKeys } from "../../core/queryKeys";
import type { ProjectSummary, ProviderInfo, ServerSettings } from "../../core/types";
import { usePageTitle, useProjectScope } from "../components/NavigationLayout";

type ProviderGroup = "claude" | "codex";

const CLAUDE_PROVIDERS = ["claude", "claude-ollama"];
const CODEX_PROVIDERS = ["codex", "codex-oss"];

function isGroupEnabled(providers: ProviderInfo[], group: ProviderGroup): boolean {
  const names = group === "claude" ? CLAUDE_PROVIDERS : CODEX_PROVIDERS;
  return providers.some((p) => names.includes(p.name) && p.enabled);
}

function filterProjectsByGroup(projects: ProjectSummary[], group: ProviderGroup): ProjectSummary[] {
  const names = group === "claude" ? CLAUDE_PROVIDERS : CODEX_PROVIDERS;
  return projects.filter((p) => names.includes(p.provider));
}

function SectionLabel({
  icon: Icon,
  label,
}: {
  icon?: React.ElementType;
  label: string;
}) {
  return (
    <div className="flex items-center gap-1.5 mb-1.5">
      {Icon ? <Icon className="w-3 h-3 text-on-surface-variant/50" /> : null}
      <p className="text-[10px] font-mono uppercase tracking-[0.24em] text-on-surface-variant/60">
        {label}
      </p>
    </div>
  );
}

function SubGroupHeader({
  icon: Icon,
  label,
}: {
  icon: React.ElementType;
  label: string;
}) {
  return (
    <div className="flex items-center gap-1.5 px-3 pt-2 pb-1">
      <Icon className="w-3 h-3 text-primary/60" />
      <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-on-surface-variant/50">
        {label}
      </p>
    </div>
  );
}

function ConfigRow({
  icon: Icon,
  label,
  value,
  empty,
}: {
  icon?: React.ElementType;
  label: string;
  value?: string;
  empty?: boolean;
}) {
  return (
    <div className="flex items-center justify-between px-3 py-1.5 gap-3">
      <div className="flex items-center gap-1.5 shrink-0">
        {Icon ? <Icon className="w-3 h-3 text-on-surface-variant/40" /> : <span className="w-3" />}
        <span className="text-[11px] text-on-surface-variant">{label}</span>
      </div>
      <span
        className={`text-[11px] font-mono truncate max-w-[190px] text-right ${empty ? "text-on-surface-variant/30 italic" : "text-on-surface"}`}
      >
        {empty || !value ? "—" : value}
      </span>
    </div>
  );
}

export function SettingsPage() {
  const { setTitle } = usePageTitle();
  const { selectedProvider, selectedProjectId, setSelectedProvider, setSelectedProjectId } =
    useProjectScope();
  const queryClient = useQueryClient();

  const [agentOpen, setAgentOpen] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);

  const [instructionsDraft, setInstructionsDraft] = useState("");
  const [settingsDraftInitialized, setSettingsDraftInitialized] = useState(false);
  const [savedInstructions, setSavedInstructions] = useState(false);

  const agentRef = useRef<HTMLDivElement>(null);
  const projectRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTitle("Settings");
    return () => setTitle("");
  }, [setTitle]);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (agentRef.current && !agentRef.current.contains(event.target as Node)) setAgentOpen(false);
      if (projectRef.current && !projectRef.current.contains(event.target as Node))
        setProjectOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const providersQuery = useQuery({
    queryKey: queryKeys.providers(),
    queryFn: ({ signal }) => api.getProviders({ signal }),
    select: (data) => data.providers,
  });

  const projectsQuery = useQuery({
    queryKey: queryKeys.projects(),
    queryFn: ({ signal }) => api.getProjects({ signal }),
    enabled: !!selectedProvider,
    select: (data) => data.projects,
  });

  const versionQuery = useQuery({
    queryKey: queryKeys.version(),
    queryFn: ({ signal }) => api.getVersion({ signal }),
  });

  const settingsQuery = useQuery({
    queryKey: queryKeys.settings(),
    queryFn: ({ signal }) => api.getSettings({ signal }),
  });

  const scholarConfigQuery = useQuery({
    queryKey: queryKeys.scholar.config(),
    queryFn: ({ signal }) => scholar.getConfig({ signal }),
    retry: false,
  });

  const updateSettingsMutation = useMutation({
    mutationFn: (nextSettings: Partial<ServerSettings>) => api.updateSettings(nextSettings),
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.settings(), updated);
      setSavedInstructions(true);
      setTimeout(() => setSavedInstructions(false), 2000);
    },
  });

  const providers: ProviderInfo[] = providersQuery.data ?? [];
  const allProjects: ProjectSummary[] = projectsQuery.data ?? [];
  const loadingProviders = providersQuery.isLoading;
  const loadingProjects = !!selectedProvider && projectsQuery.isLoading;
  const version = versionQuery.data ?? null;
  const settings = settingsQuery.data?.settings ?? {};
  const scholarConfig: ScholarConfig | null = scholarConfigQuery.data ?? null;
  const scholarConfigError = !!scholarConfigQuery.error;

  useEffect(() => {
    if (!settingsQuery.data || settingsDraftInitialized) return;
    setInstructionsDraft(settingsQuery.data.settings.globalInstructions ?? "");
    setSettingsDraftInitialized(true);
  }, [settingsDraftInitialized, settingsQuery.data]);

  useEffect(() => {
    if (!selectedProvider || !projectsQuery.data) return;
    if (selectedProjectId && !projectsQuery.data.some((p) => p.id === selectedProjectId)) {
      setSelectedProjectId(null);
    }
  }, [projectsQuery.data, selectedProjectId, selectedProvider, setSelectedProjectId]);

  const filteredProjects = selectedProvider
    ? filterProjectsByGroup(allProjects, selectedProvider)
    : [];
  const selectedProject = filteredProjects.find((p) => p.id === selectedProjectId) ?? null;
  const claudeProvider = providers.find((p) => CLAUDE_PROVIDERS.includes(p.name) && p.enabled);

  const handleProviderSelect = (group: ProviderGroup) => {
    if (!isGroupEnabled(providers, group)) return;
    setSelectedProvider(group);
    setSelectedProjectId(null);
    setAgentOpen(false);
  };

  const handleSaveInstructions = () => {
    updateSettingsMutation.mutate({
      globalInstructions: instructionsDraft || undefined,
    });
  };

  const instructionsDirty = instructionsDraft !== (settings.globalInstructions ?? "");
  const savingInstructions = updateSettingsMutation.isPending;

  return (
    <div className="max-w-3xl mx-auto pt-3 pb-6 flex flex-col gap-4">
      {/* ── Top two-column grid ── */}
      <div className="grid grid-cols-[1fr_1.15fr] gap-4 items-start">
        {/* Left column */}
        <div className="flex flex-col gap-4">
          {/* Agent & Project */}
          <div>
            <SectionLabel icon={Bot} label="Agent & Project" />
            <div className="bg-surface-container-low rounded-xl border border-outline-variant/10 divide-y divide-outline-variant/10">
              {/* Agent */}
              <div className="p-3" ref={agentRef}>
                <p className="text-[10px] font-mono text-on-surface-variant/50 mb-1.5 px-0.5">
                  Agent
                </p>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => !loadingProviders && setAgentOpen((v) => !v)}
                    disabled={loadingProviders}
                    className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg border border-outline-variant/20 bg-surface-container hover:bg-surface-container-high transition-all text-left cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <span className="text-sm text-on-surface">
                      {loadingProviders ? (
                        <span className="text-on-surface-variant/50">Detecting…</span>
                      ) : selectedProvider ? (
                        <span className="font-medium capitalize">{selectedProvider}</span>
                      ) : (
                        <span className="text-on-surface-variant/50">Select agent</span>
                      )}
                    </span>
                    <ChevronDown
                      className={`w-3.5 h-3.5 shrink-0 text-on-surface-variant transition-transform duration-200 ${agentOpen ? "rotate-180" : ""}`}
                    />
                  </button>
                  {agentOpen ? (
                    <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-surface-container rounded-xl border border-outline-variant/20 shadow-lg overflow-hidden">
                      {(["claude", "codex"] as ProviderGroup[]).map((group) => {
                        const enabled = isGroupEnabled(providers, group);
                        const isSelected = selectedProvider === group;
                        return (
                          <button
                            key={group}
                            type="button"
                            disabled={!enabled}
                            onClick={() => handleProviderSelect(group)}
                            className={`w-full flex items-center justify-between px-3 py-2 text-left transition-colors ${isSelected ? "bg-primary/10 text-primary" : enabled ? "text-on-surface hover:bg-surface-container-high cursor-pointer" : "text-on-surface-variant/30 cursor-not-allowed"}`}
                          >
                            <div>
                              <p className="text-sm font-semibold capitalize">{group}</p>
                              <p className="text-[10px] font-mono">
                                {enabled ? (isSelected ? "Active" : "Available") : "Not detected"}
                              </p>
                            </div>
                            {isSelected ? (
                              <CheckCircle2 className="w-4 h-4 text-primary fill-primary/10 shrink-0" />
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              </div>

              {/* Project */}
              {selectedProvider ? (
                <div className="p-3" ref={projectRef}>
                  <p className="text-[10px] font-mono text-on-surface-variant/50 mb-1.5 px-0.5">
                    Project
                  </p>
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => !loadingProjects && setProjectOpen((v) => !v)}
                      disabled={loadingProjects || filteredProjects.length === 0}
                      className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg border border-outline-variant/20 bg-surface-container hover:bg-surface-container-high transition-all text-left cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <span className="text-sm truncate flex-1 min-w-0">
                        {loadingProjects ? (
                          <span className="text-on-surface-variant/50">Loading…</span>
                        ) : selectedProject ? (
                          <span className="font-medium text-on-surface">
                            {selectedProject.name ?? selectedProject.path}
                          </span>
                        ) : filteredProjects.length === 0 ? (
                          <span className="text-on-surface-variant/50">No projects found</span>
                        ) : (
                          <span className="text-on-surface-variant/50">Select project</span>
                        )}
                      </span>
                      {filteredProjects.length > 0 ? (
                        <ChevronDown
                          className={`w-3.5 h-3.5 shrink-0 text-on-surface-variant transition-transform duration-200 ${projectOpen ? "rotate-180" : ""}`}
                        />
                      ) : null}
                    </button>
                    {projectOpen ? (
                      <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-surface-container rounded-xl border border-outline-variant/20 shadow-lg overflow-hidden max-h-52 overflow-y-auto no-scrollbar">
                        {filteredProjects.map((project) => {
                          const isSelected = selectedProjectId === project.id;
                          return (
                            <button
                              key={project.id}
                              type="button"
                              onClick={() => {
                                setSelectedProjectId(isSelected ? null : project.id);
                                setProjectOpen(false);
                              }}
                              className={`w-full flex items-center justify-between gap-3 px-3 py-2 text-left transition-colors cursor-pointer ${isSelected ? "bg-primary/10 text-primary" : "text-on-surface hover:bg-surface-container-high"}`}
                            >
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium truncate">
                                  {project.name ?? project.path}
                                </p>
                                <p className="text-[10px] font-mono text-on-surface-variant/60 truncate">
                                  {project.path}
                                </p>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface-container-high text-on-surface-variant">
                                  {project.sessionCount}
                                </span>
                                {isSelected ? (
                                  <CheckCircle2 className="w-3.5 h-3.5 text-primary fill-primary/10" />
                                ) : null}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          {/* Provider Status */}
          <div>
            <SectionLabel icon={Wifi} label="Provider Status" />
            <div className="bg-surface-container-low rounded-xl border border-outline-variant/10 divide-y divide-outline-variant/10">
              {loadingProviders ? (
                <div className="px-3 py-2 text-[11px] text-on-surface-variant/50 font-mono">
                  Detecting…
                </div>
              ) : providers.length === 0 ? (
                <div className="px-3 py-2 text-[11px] text-on-surface-variant/50">
                  No providers detected
                </div>
              ) : (
                providers.map((provider) => (
                  <div key={provider.name} className="flex items-center gap-2.5 px-3 py-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-medium text-on-surface">
                        {provider.displayName}
                      </p>
                      <p className="text-[10px] font-mono text-on-surface-variant/50 truncate">
                        {provider.user?.email ||
                          (provider.installed
                            ? provider.authenticated
                              ? "Authenticated"
                              : "Not authenticated"
                            : "Not installed")}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {provider.enabled ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-primary fill-primary/10" />
                      ) : (
                        <AlertCircle className="w-3.5 h-3.5 text-on-surface-variant/30" />
                      )}
                      <span
                        className={`text-[10px] font-mono ${provider.enabled ? "text-primary" : "text-on-surface-variant/40"}`}
                      >
                        {provider.enabled ? "ON" : "OFF"}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Server */}
          <div>
            <SectionLabel icon={Server} label="Server" />
            <div className="bg-surface-container-low rounded-xl border border-outline-variant/10 divide-y divide-outline-variant/10">
              <div className="flex items-center justify-between px-3 py-2">
                <div className="flex items-center gap-1.5">
                  <Cpu className="w-3 h-3 text-on-surface-variant/40" />
                  <span className="text-[11px] text-on-surface-variant">Hub Version</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-mono text-on-surface">
                    {version?.current ?? "—"}
                  </span>
                  {version?.updateAvailable && version.latest ? (
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-tertiary/10 text-tertiary">
                      {version.latest}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="flex items-center justify-between px-3 py-2">
                <div className="flex items-center gap-1.5">
                  <FolderKanban className="w-3 h-3 text-on-surface-variant/40" />
                  <span className="text-[11px] text-on-surface-variant">Project</span>
                </div>
                <span className="text-[11px] font-mono text-on-surface truncate max-w-[160px]">
                  {selectedProject ? (
                    (selectedProject.name ?? selectedProject.path.split("/").pop())
                  ) : (
                    <span className="text-on-surface-variant/40">None</span>
                  )}
                </span>
              </div>
              {claudeProvider?.expiresAt ? (
                <div className="flex items-center justify-between px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    <KeyRound className="w-3 h-3 text-on-surface-variant/40" />
                    <span className="text-[11px] text-on-surface-variant">Claude auth expires</span>
                  </div>
                  <span className="text-[10px] font-mono text-on-surface-variant/60">
                    {new Date(claudeProvider.expiresAt).toLocaleDateString()}
                  </span>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {/* Right column — ScholarAIO */}
        <div>
          <SectionLabel icon={Sparkles} label="ScholarAIO" />
          <div className="bg-surface-container-low rounded-xl border border-outline-variant/10 divide-y divide-outline-variant/10">
            {scholarConfigError ? (
              <div className="flex items-center gap-2 px-3 py-3 text-[11px] text-on-surface-variant/60">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>
                  服务未运行。执行 <code className="font-mono">scholaraio serve</code> 后刷新。
                </span>
              </div>
            ) : scholarConfig === null ? (
              <div className="px-3 py-3 text-[11px] text-on-surface-variant/50 font-mono">
                Loading…
              </div>
            ) : (
              <>
                {/* LLM */}
                <div className="pb-1">
                  <SubGroupHeader icon={Brain} label="LLM" />
                  <ConfigRow icon={Cpu} label="Backend" value={scholarConfig.llm.backend} />
                  <ConfigRow icon={Sparkles} label="Model" value={scholarConfig.llm.model} />
                  <ConfigRow icon={Globe} label="Base URL" value={scholarConfig.llm.base_url} />
                  <ConfigRow
                    icon={KeyRound}
                    label="API Key"
                    value={scholarConfig.llm.api_key}
                    empty={!scholarConfig.llm.api_key}
                  />
                </div>

                {/* Embedding */}
                <div className="pb-1">
                  <SubGroupHeader icon={Layers} label="Embedding" />
                  <ConfigRow icon={Sparkles} label="Model" value={scholarConfig.embed.model} />
                  <ConfigRow icon={Link} label="Source" value={scholarConfig.embed.source} />
                  <ConfigRow
                    icon={KeyRound}
                    label="API Key"
                    value={scholarConfig.embed.api_key}
                    empty={!scholarConfig.embed.api_key}
                  />
                </div>

                {/* Ingest */}
                <div className="pb-1">
                  <SubGroupHeader icon={ArrowDownToLine} label="Ingest" />
                  <ConfigRow
                    icon={Globe}
                    label="MinerU Endpoint"
                    value={scholarConfig.ingest.mineru_endpoint}
                  />
                  <ConfigRow
                    icon={KeyRound}
                    label="MinerU Key"
                    value={scholarConfig.ingest.mineru_api_key}
                    empty={!scholarConfig.ingest.mineru_api_key}
                  />
                  <ConfigRow
                    icon={KeyRound}
                    label="S2 Key"
                    value={scholarConfig.ingest.s2_api_key}
                    empty={!scholarConfig.ingest.s2_api_key}
                  />
                </div>

                {/* Paths */}
                <div className="pb-1">
                  <SubGroupHeader icon={HardDrive} label="Paths" />
                  <ConfigRow
                    icon={FolderOpen}
                    label="Papers"
                    value={scholarConfig.paths.papers_dir}
                  />
                  <ConfigRow
                    icon={FolderKanban}
                    label="Workspaces"
                    value={scholarConfig.paths.workspace_dir}
                  />
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Full-width: Global Instructions ── */}
      <div>
        <SectionLabel icon={Bot} label="Global Instructions" />
        <div className="bg-surface-container-low rounded-xl border border-outline-variant/10 p-3 flex gap-3 items-start">
          <textarea
            value={instructionsDraft}
            onChange={(e) => setInstructionsDraft(e.target.value)}
            placeholder="每个新会话的系统级补充指令。e.g. Always reply in English. Prefer concise answers."
            rows={3}
            className="flex-1 bg-surface-container border border-outline-variant/20 rounded-lg px-3 py-2 text-sm font-sans text-on-surface placeholder:text-on-surface-variant/40 outline-none focus:border-primary/30 focus:ring-1 focus:ring-primary/10 resize-none transition-all"
          />
          <button
            type="button"
            onClick={handleSaveInstructions}
            disabled={!instructionsDirty || savingInstructions}
            className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${savedInstructions ? "bg-primary/10 text-primary" : instructionsDirty ? "bg-primary text-on-primary hover:opacity-90" : "bg-surface-container text-on-surface-variant/40 cursor-not-allowed"}`}
          >
            {savingInstructions ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : savedInstructions ? (
              <CheckCircle2 className="w-3.5 h-3.5" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            {savedInstructions ? "Saved" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
