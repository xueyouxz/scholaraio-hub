import { AlertCircle, CheckCircle2, ChevronDown, Cpu, Database, FileText } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../core/api";
import type { ProjectSummary, ProviderInfo } from "../../core/types";
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

export function SettingsPage() {
  const { setTitle } = usePageTitle();
  const { selectedProvider, selectedProjectId, setSelectedProvider, setSelectedProjectId } =
    useProjectScope();

  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [allProjects, setAllProjects] = useState<ProjectSummary[]>([]);
  const [loadingProviders, setLoadingProviders] = useState(true);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);

  const agentRef = useRef<HTMLDivElement>(null);
  const projectRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTitle("Settings");
    return () => setTitle("");
  }, [setTitle]);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (agentRef.current && !agentRef.current.contains(event.target as Node)) {
        setAgentOpen(false);
      }
      if (projectRef.current && !projectRef.current.contains(event.target as Node)) {
        setProjectOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Load providers on mount
  useEffect(() => {
    void api
      .getProviders()
      .then((data) => setProviders(data.providers))
      .catch(() => {})
      .finally(() => setLoadingProviders(false));
  }, []);

  // Load projects when provider changes
  useEffect(() => {
    if (!selectedProvider) return;
    setLoadingProjects(true);
    void api
      .getProjects()
      .then((data) => {
        const projects = data.projects;
        setAllProjects(projects);
        if (selectedProjectId) {
          const stillExists = projects.some((p) => p.id === selectedProjectId);
          if (!stillExists) {
            setSelectedProjectId(null);
          }
        }
      })
      .catch(() => {})
      .finally(() => setLoadingProjects(false));
  }, [selectedProvider, selectedProjectId, setSelectedProjectId]);

  const claudeEnabled = isGroupEnabled(providers, "claude");
  const codexEnabled = isGroupEnabled(providers, "codex");

  const filteredProjects = selectedProvider
    ? filterProjectsByGroup(allProjects, selectedProvider)
    : [];

  const selectedProject = filteredProjects.find((p) => p.id === selectedProjectId) ?? null;

  const handleProviderSelect = (group: ProviderGroup) => {
    if (!isGroupEnabled(providers, group)) return;
    setSelectedProvider(group);
    setSelectedProjectId(null);
    setAgentOpen(false);
  };

  return (
    <div className="flex flex-col items-center gap-6 pt-4">
      {/* LLM Section */}
      <div className="w-full max-w-sm bg-surface-container-low rounded-[2rem] p-8 border border-outline-variant/10">
        <div className="flex justify-between items-start mb-8">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-secondary-container rounded-xl text-primary">
              <Cpu className="w-6 h-6" />
            </div>
            <div>
              <h4 className="font-serif text-2xl font-bold">Large Language Model</h4>
              <p className="text-xs text-on-surface-variant font-sans">
                Agent selection and project scope
              </p>
            </div>
          </div>
          {selectedProvider ? (
            <CheckCircle2 className="w-6 h-6 text-primary fill-primary/10" />
          ) : (
            <AlertCircle className="w-6 h-6 text-on-surface-variant/40" />
          )}
        </div>

        <div className="space-y-3">
          {/* Agent dropdown card */}
          <div>
            <p className="text-[10px] font-mono uppercase tracking-[0.24em] text-on-surface-variant mb-2">
              Agent
            </p>
            <div ref={agentRef} className="relative">
              <button
                type="button"
                onClick={() => !loadingProviders && setAgentOpen((v) => !v)}
                disabled={loadingProviders}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-2xl border border-outline-variant/20 bg-surface-container hover:bg-surface-container-high transition-all text-left cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="min-w-0">
                  {loadingProviders ? (
                    <span className="text-sm text-on-surface-variant/60">Detecting providers…</span>
                  ) : selectedProvider ? (
                    <>
                      <p className="text-sm font-semibold capitalize text-on-surface">
                        {selectedProvider}
                      </p>
                      <p className="text-[10px] font-mono text-on-surface-variant/60">Active</p>
                    </>
                  ) : (
                    <span className="text-sm text-on-surface-variant/60">Select an agent</span>
                  )}
                </div>
                <ChevronDown
                  className={`w-4 h-4 shrink-0 text-on-surface-variant transition-transform duration-200 ${agentOpen ? "rotate-180" : ""}`}
                />
              </button>

              {agentOpen ? (
                <div className="absolute top-full left-0 right-0 mt-1.5 z-50 bg-surface-container rounded-2xl border border-outline-variant/20 shadow-lg overflow-hidden">
                  {(["claude", "codex"] as ProviderGroup[]).map((group) => {
                    const enabled = isGroupEnabled(providers, group);
                    const isSelected = selectedProvider === group;
                    return (
                      <button
                        key={group}
                        type="button"
                        disabled={!enabled}
                        onClick={() => handleProviderSelect(group)}
                        className={`w-full flex items-center justify-between px-4 py-3 text-left transition-colors ${
                          isSelected
                            ? "bg-primary/8 text-primary"
                            : enabled
                              ? "text-on-surface hover:bg-surface-container-high cursor-pointer"
                              : "text-on-surface-variant/30 cursor-not-allowed"
                        }`}
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

          {/* Project dropdown card */}
          {selectedProvider ? (
            <div>
              <p className="text-[10px] font-mono uppercase tracking-[0.24em] text-on-surface-variant mb-2">
                Project
              </p>
              <div ref={projectRef} className="relative">
                <button
                  type="button"
                  onClick={() => !loadingProjects && setProjectOpen((v) => !v)}
                  disabled={loadingProjects || filteredProjects.length === 0}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-2xl border border-outline-variant/20 bg-surface-container hover:bg-surface-container-high transition-all text-left cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <div className="min-w-0 flex-1">
                    {loadingProjects ? (
                      <span className="text-sm text-on-surface-variant/60">Loading projects…</span>
                    ) : selectedProject ? (
                      <>
                        <p className="text-sm font-medium text-on-surface truncate">
                          {selectedProject.name ?? selectedProject.path}
                        </p>
                        <p className="text-[10px] font-mono text-on-surface-variant/60 truncate">
                          {selectedProject.path}
                        </p>
                      </>
                    ) : filteredProjects.length === 0 ? (
                      <span className="text-sm text-on-surface-variant/60">
                        No {selectedProvider} projects found
                      </span>
                    ) : (
                      <span className="text-sm text-on-surface-variant/60">Select a project</span>
                    )}
                  </div>
                  {filteredProjects.length > 0 ? (
                    <ChevronDown
                      className={`w-4 h-4 shrink-0 text-on-surface-variant transition-transform duration-200 ${projectOpen ? "rotate-180" : ""}`}
                    />
                  ) : null}
                </button>

                {projectOpen ? (
                  <div className="absolute top-full left-0 right-0 mt-1.5 z-50 bg-surface-container rounded-2xl border border-outline-variant/20 shadow-lg overflow-hidden max-h-64 overflow-y-auto no-scrollbar">
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
                          className={`w-full flex items-center justify-between gap-3 px-4 py-3 text-left transition-colors cursor-pointer ${
                            isSelected
                              ? "bg-primary/8 text-primary"
                              : "text-on-surface hover:bg-surface-container-high"
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate">
                              {project.name ?? project.path}
                            </p>
                            <p className="text-[10px] font-mono text-on-surface-variant/60 truncate">
                              {project.path}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-surface-container-high text-on-surface-variant">
                              {project.sessionCount}
                            </span>
                            {isSelected ? (
                              <CheckCircle2 className="w-4 h-4 text-primary fill-primary/10" />
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

      {/* Placeholder cards */}
      <div className="w-full max-w-sm grid grid-cols-1 gap-6">
        {/* Vector Embeddings */}
        <div className="bg-surface-container-low rounded-[2rem] p-8 border border-outline-variant/10">
          <div className="flex justify-between items-start mb-6">
            <div className="flex items-center gap-3">
              <Database className="w-5 h-5 text-primary" />
              <h4 className="font-serif text-xl font-bold">Vector Embeddings</h4>
            </div>
            <CheckCircle2 className="w-5 h-5 text-primary fill-primary/10 opacity-30" />
          </div>
          <div className="space-y-4">
            <div className="space-y-1">
              <p className="text-[10px] uppercase font-bold text-on-surface-variant font-mono">
                Embedding Model
              </p>
              <p className="font-mono text-sm italic opacity-40">Not configured</p>
            </div>
            <div className="space-y-1">
              <p className="text-[10px] uppercase font-bold text-on-surface-variant font-mono">
                Vector Store
              </p>
              <p className="font-mono text-sm italic opacity-40">Not configured</p>
            </div>
          </div>
        </div>

        {/* MinerU Configuration */}
        <div className="bg-surface-container-low rounded-[2rem] p-8 border border-outline-variant/10">
          <div className="flex justify-between items-start mb-6">
            <div className="flex items-center gap-3">
              <FileText className="w-5 h-5 text-primary" />
              <h4 className="font-serif text-xl font-bold">MinerU Configuration</h4>
            </div>
            <AlertCircle className="w-5 h-5 text-error opacity-40" />
          </div>
          <div className="space-y-4">
            <div className="space-y-1">
              <p className="text-[10px] uppercase font-bold text-on-surface-variant font-mono">
                MinerU Path
              </p>
              <p className="font-mono text-sm italic opacity-40">Not configured</p>
            </div>
            <div className="space-y-1">
              <p className="text-[10px] uppercase font-bold text-on-surface-variant font-mono">
                MinerU Model
              </p>
              <p className="font-mono text-sm italic opacity-40">Not specified</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
