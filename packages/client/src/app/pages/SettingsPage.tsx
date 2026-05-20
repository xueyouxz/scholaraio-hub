import { useQuery } from "@tanstack/react-query";
import { AlertCircle, ArrowDownToLine, Brain, CheckCircle2, HardDrive, Layers } from "lucide-react";
import { useEffect } from "react";
import { type ScholarConfig, api, scholar } from "../../core/api";
import { queryKeys } from "../../core/queryKeys";
import type { ProviderInfo, ProviderUsageLimits } from "../../core/types";
import { usePageTitle, useProjectScope } from "../components/NavigationLayout";

type ProviderGroup = "claude" | "codex";

const CLAUDE_PROVIDERS = ["claude", "claude-ollama"];
const CODEX_PROVIDERS = ["codex", "codex-oss"];

function isGroupEnabled(providers: ProviderInfo[], group: ProviderGroup): boolean {
  const names = group === "claude" ? CLAUDE_PROVIDERS : CODEX_PROVIDERS;
  return providers.some((p) => names.includes(p.name) && p.enabled);
}

function getGroupEmail(providers: ProviderInfo[], group: ProviderGroup): string | null {
  const names = group === "claude" ? CLAUDE_PROVIDERS : CODEX_PROVIDERS;
  const p = providers.find((p) => names.includes(p.name) && p.enabled);
  return p?.user?.email ?? null;
}

function getGroupUsageLimits(
  usageLimits: ProviderUsageLimits[],
  group: ProviderGroup,
): ProviderUsageLimits | null {
  const names = group === "claude" ? CLAUDE_PROVIDERS : CODEX_PROVIDERS;
  return usageLimits.find((item) => names.includes(item.provider)) ?? null;
}

function formatResetTime(value?: string): string {
  if (!value) return "Reset unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Reset unknown";
  return `Resets ${date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

const AGENT_CONFIG = {
  claude: { name: "Claude Code", icon: "/icons/claudecode-color.svg" },
  codex: { name: "Codex", icon: "/icons/codex-color.svg" },
} as const;

function SectionLabel({ label }: { label: string }) {
  return (
    <p className="text-[10px] font-mono uppercase tracking-[0.24em] text-on-surface-variant/60 mb-1.5">
      {label}
    </p>
  );
}

function SubGroupHeader({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
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
  label,
  description,
  value,
  empty,
}: {
  label: string;
  description: string;
  value?: string;
  empty?: boolean;
}) {
  return (
    <div className="flex items-start justify-between px-4 py-3 gap-6">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-on-surface">{label}</p>
        <p className="text-[12px] text-on-surface-variant/60 mt-0.5">{description}</p>
      </div>
      <span
        className={`text-[11px] font-mono truncate max-w-[240px] text-right shrink-0 mt-0.5 ${
          empty ? "text-on-surface-variant/30 italic" : "text-on-surface/80"
        }`}
      >
        {empty || !value ? "—" : value}
      </span>
    </div>
  );
}

function UsageLimitRow({
  label,
  usedPercent,
  resetsAt,
}: {
  label: string;
  usedPercent?: number;
  resetsAt?: string;
}) {
  const percent = usedPercent === undefined ? null : Math.round(usedPercent);
  const width = percent === null ? 0 : Math.min(100, Math.max(0, percent));

  return (
    <div className="px-4 py-2">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <span className="text-[12px] font-medium text-on-surface">{label}</span>
          <p className="text-[10px] text-on-surface-variant/50 mt-0.5">
            {formatResetTime(resetsAt)}
          </p>
        </div>
        <span className="text-[11px] font-mono text-on-surface/70 shrink-0">
          {percent === null ? "—" : `${percent}%`}
        </span>
      </div>
      <div className="mt-1.5 h-1 rounded-full bg-surface-container-high overflow-hidden">
        <div className="h-full rounded-full bg-primary" style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function UsageLimitBlock({
  limits,
  loading,
}: {
  limits: ProviderUsageLimits | null;
  loading: boolean;
}) {
  const fiveHour = limits?.windows.find((window) => window.name === "fiveHour");
  const weekly =
    limits?.windows.find((window) => window.name === "weekly") ??
    limits?.windows.find((window) => window.name === "weeklySonnet") ??
    limits?.windows.find((window) => window.name === "weeklyOpus");

  return (
    <div className="border-t border-outline-variant/10">
      {limits?.available ? (
        <div className="divide-y divide-outline-variant/10">
          <UsageLimitRow
            label="5 hours"
            usedPercent={fiveHour?.usedPercent}
            resetsAt={fiveHour?.resetsAt}
          />
          <UsageLimitRow
            label="Weekly"
            usedPercent={weekly?.usedPercent}
            resetsAt={weekly?.resetsAt}
          />
        </div>
      ) : (
        <div className="px-4 py-2 text-[11px] text-on-surface-variant/50">
          {loading ? "Loading…" : (limits?.error ?? "No usage limit data has been reported yet.")}
        </div>
      )}
    </div>
  );
}

export function SettingsPage() {
  const { setTitle } = usePageTitle();
  const { selectedProvider, setSelectedProvider, setSelectedProjectId } = useProjectScope();

  useEffect(() => {
    setTitle("Settings");
    return () => setTitle("");
  }, [setTitle]);

  const providersQuery = useQuery({
    queryKey: queryKeys.providers(),
    queryFn: ({ signal }) => api.getProviders({ signal }),
    select: (data) => data.providers,
  });

  const scholarConfigQuery = useQuery({
    queryKey: queryKeys.scholar.config(),
    queryFn: ({ signal }) => scholar.getConfig({ signal }),
    retry: false,
  });

  const usageLimitsQuery = useQuery({
    queryKey: queryKeys.providerUsageLimits(),
    queryFn: ({ signal }) => api.getProviderUsageLimits({ signal }),
    select: (data) => data.usageLimits,
    refetchInterval: 60_000,
  });

  const providers: ProviderInfo[] = providersQuery.data ?? [];
  const usageLimits: ProviderUsageLimits[] = usageLimitsQuery.data ?? [];
  const loadingProviders = providersQuery.isLoading;
  const scholarConfig: ScholarConfig | null = scholarConfigQuery.data ?? null;
  const scholarConfigError = !!scholarConfigQuery.error;

  const handleProviderSelect = (group: ProviderGroup) => {
    if (!isGroupEnabled(providers, group)) return;
    setSelectedProvider(group);
    setSelectedProjectId(null);
  };

  return (
    <div className="max-w-6xl mx-auto pt-3 pb-6 flex flex-col gap-6">
      {/* Agent selector cards */}
      <div>
        <SectionLabel label="Agent" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {(["claude", "codex"] as ProviderGroup[]).map((group) => {
            const enabled = !loadingProviders && isGroupEnabled(providers, group);
            const isSelected = selectedProvider === group;
            const email = getGroupEmail(providers, group);
            const limits = getGroupUsageLimits(usageLimits, group);
            const cfg = AGENT_CONFIG[group];
            return (
              <div
                key={group}
                className={`relative rounded-2xl border overflow-hidden transition-all duration-200 ${
                  isSelected
                    ? "border-primary/40 bg-primary/5 shadow-sm"
                    : enabled
                      ? "border-outline-variant/20 bg-surface-container-low hover:border-outline-variant/40"
                      : "border-outline-variant/10 bg-surface-container-low/50"
                }`}
              >
                <button
                  type="button"
                  disabled={!enabled}
                  onClick={() => handleProviderSelect(group)}
                  className={`relative flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors ${
                    enabled
                      ? "hover:bg-surface-container cursor-pointer"
                      : "opacity-40 cursor-not-allowed"
                  }`}
                >
                  <img
                    src={cfg.icon}
                    alt={cfg.name}
                    className="w-9 h-9 shrink-0 rounded-lg object-contain"
                  />
                  <div className="min-w-0 flex-1 pr-6">
                    <p className="text-sm font-semibold text-on-surface">{cfg.name}</p>
                    <p className="text-[10px] font-mono text-on-surface-variant/60 truncate mt-0.5">
                      {loadingProviders
                        ? "Detecting…"
                        : enabled
                          ? (email ?? "Active")
                          : "Not detected"}
                    </p>
                  </div>
                  {isSelected ? (
                    <CheckCircle2 className="w-4 h-4 text-primary fill-primary/10 shrink-0 absolute top-3 right-3" />
                  ) : null}
                </button>
                <UsageLimitBlock limits={limits} loading={usageLimitsQuery.isLoading} />
              </div>
            );
          })}
        </div>
      </div>

      {/* ScholarAIO config */}
      <div>
        <SectionLabel label="ScholarAIO" />
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
              <div className="pb-1">
                <SubGroupHeader icon={Brain} label="LLM" />
                <ConfigRow
                  label="Backend"
                  description="推理后端提供商"
                  value={scholarConfig.llm.backend}
                />
                <ConfigRow
                  label="Model"
                  description="使用的语言模型"
                  value={scholarConfig.llm.model}
                />
                <ConfigRow
                  label="Base URL"
                  description="API 服务地址"
                  value={scholarConfig.llm.base_url}
                />
                <ConfigRow
                  label="API Key"
                  description="访问凭证"
                  value={scholarConfig.llm.api_key}
                  empty={!scholarConfig.llm.api_key}
                />
              </div>
              <div className="pb-1">
                <SubGroupHeader icon={Layers} label="Embedding" />
                <ConfigRow
                  label="Model"
                  description="文本向量化模型"
                  value={scholarConfig.embed.model}
                />
                <ConfigRow
                  label="Source"
                  description="向量数据来源"
                  value={scholarConfig.embed.source}
                />
                <ConfigRow
                  label="API Key"
                  description="访问凭证"
                  value={scholarConfig.embed.api_key}
                  empty={!scholarConfig.embed.api_key}
                />
              </div>
              <div className="pb-1">
                <SubGroupHeader icon={ArrowDownToLine} label="Ingest" />
                <ConfigRow
                  label="MinerU Endpoint"
                  description="PDF 解析服务地址"
                  value={scholarConfig.ingest.mineru_endpoint}
                />
                <ConfigRow
                  label="MinerU Key"
                  description="MinerU 访问凭证"
                  value={scholarConfig.ingest.mineru_api_key}
                  empty={!scholarConfig.ingest.mineru_api_key}
                />
                <ConfigRow
                  label="S2 Key"
                  description="Semantic Scholar API 凭证"
                  value={scholarConfig.ingest.s2_api_key}
                  empty={!scholarConfig.ingest.s2_api_key}
                />
              </div>
              <div className="pb-1">
                <SubGroupHeader icon={HardDrive} label="Paths" />
                <ConfigRow
                  label="Papers"
                  description="论文文件存储目录"
                  value={scholarConfig.paths.papers_dir}
                />
                <ConfigRow
                  label="Workspaces"
                  description="工作区根目录"
                  value={scholarConfig.paths.workspace_dir}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
