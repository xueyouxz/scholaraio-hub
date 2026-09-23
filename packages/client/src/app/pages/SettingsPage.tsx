import type { NewSessionDefaults } from "@scholaraio-hub/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, FolderOpen } from "lucide-react";
import { useEffect } from "react";
import { requestJson } from "../../core/http";
import { settingsApi } from "../../core/library";
import { LibrarySettingsForm } from "../../features/library/components/LibrarySettingsForm";
import { usePageTitle } from "../components/NavigationLayout";
import { UsageLimitBlock } from "../components/ProviderUsage";

export function SettingsPage() {
  const { setTitle } = usePageTitle();
  const client = useQueryClient();
  useEffect(() => {
    setTitle("Settings");
    return () => setTitle("");
  }, [setTitle]);
  const settings = useQuery({
    queryKey: ["app-settings"],
    queryFn: ({ signal }) => settingsApi.get(signal),
  });
  const status = useQuery({
    queryKey: ["app-status"],
    queryFn: ({ signal }) =>
      requestJson<{ dataDir: string; profile: string }>("/api/status", { signal }),
  });
  const providers = useQuery({
    queryKey: ["providers"],
    queryFn: ({ signal }) => settingsApi.providers(signal),
    staleTime: 60_000,
  });
  const usage = useQuery({
    queryKey: ["provider-usage-limits"],
    queryFn: ({ signal }) => settingsApi.usageLimits(signal),
    staleTime: 60_000,
  });
  const save = useMutation({
    mutationFn: settingsApi.save,
    onSuccess: (data) => client.setQueryData(["app-settings"], data),
  });
  const openDataDir = useMutation({
    mutationFn: () =>
      requestJson<{ opened: boolean }>("/api/status/data-dir/open", { method: "POST" }),
  });
  const defaults = settings.data?.settings.newSessionDefaults;
  const providerName = defaults?.provider === "codex" ? "codex" : "claude";
  const update = (value: NewSessionDefaults) => {
    save.mutate({ ...defaults, ...value });
  };
  const error =
    settings.error ?? providers.error ?? save.error ?? status.error ?? openDataDir.error;
  return (
    <div className="w-full max-w-3xl mx-auto pt-3 pb-6 flex flex-col gap-5">
      <section className="space-y-3">
        <p className="text-sm text-on-surface-variant">
          选择新会话默认使用的工具。已有会话继续使用创建时的工具。
        </p>
        <fieldset className="grid md:grid-cols-2 gap-3" aria-label="默认 AI 工具">
          {(["claude", "codex"] as const).map((name) => {
            const item = providers.data?.providers.find((p) => p.name === name);
            return (
              <button
                key={name}
                type="button"
                aria-pressed={providerName === name}
                disabled={!settings.data || save.isPending}
                onClick={() => update({ provider: name, model: undefined })}
                className={`relative block w-full rounded-lg border overflow-hidden text-left transition-colors ${providerName === name ? "border-primary/30 bg-primary/5" : "border-outline-variant/15 bg-surface-container-low hover:bg-surface-container"}`}
              >
                <span className="relative flex w-full items-center gap-2.5 px-3 py-2.5">
                  <img
                    src={`/icons/${name === "claude" ? "claudecode" : "codex"}-color.svg`}
                    width={24}
                    height={24}
                    alt=""
                    className="w-6 h-6 shrink-0 rounded object-contain"
                  />
                  <span className="min-w-0 flex-1 pr-5">
                    <span className="block text-sm font-semibold text-on-surface leading-tight">
                      {name === "claude" ? "Claude Code" : "Codex"}
                    </span>
                    <span className="block text-[10px] font-mono text-on-surface-variant/60 truncate">
                      {providers.isLoading
                        ? "检测中…"
                        : !item
                          ? "当前环境未启用"
                          : !item.installed
                            ? "未找到可用的 CLI"
                            : item.authenticated
                              ? "已安装并登录"
                              : "已安装，尚未登录"}
                      {item?.user?.email ? ` · ${item.user.email}` : ""}
                    </span>
                  </span>
                </span>
                {providerName === name ? (
                  <CheckCircle2
                    className="absolute top-2.5 right-2.5 w-4 h-4 text-primary"
                    aria-hidden="true"
                  />
                ) : null}
                <UsageLimitBlock
                  limits={usage.data?.usageLimits.find((item) => item.provider === name) ?? null}
                  loading={usage.isLoading}
                />
              </button>
            );
          })}
        </fieldset>
        <div className="flex flex-wrap items-center gap-3">
          <button
            className="hub-button"
            disabled={providers.isFetching}
            type="button"
            onClick={() => void providers.refetch()}
          >
            重新检测
          </button>
          <p className="text-xs text-on-surface-variant">
            {providerName === "claude"
              ? "在终端运行 claude auth login 完成登录。"
              : "在终端运行 codex login 完成登录。"}
          </p>
          {save.isSuccess ? <output className="text-sm text-primary">设置已保存</output> : null}
        </div>
      </section>
      {error ? (
        <p role="alert" className="text-error break-words">
          {error.message}
        </p>
      ) : null}
      <LibrarySettingsForm />
      <section className="rounded-lg border border-outline-variant/15 bg-surface-container-low px-4 py-3 space-y-1.5">
        <div className="flex items-center gap-2">
          <p className="flex-1 min-w-0 text-sm text-on-surface">数据目录</p>
          <button
            type="button"
            aria-label="在文件管理器中打开数据目录"
            title="在文件管理器中打开"
            disabled={openDataDir.isPending || !status.data}
            onClick={() => openDataDir.mutate()}
            className="flex items-center justify-center w-7 h-7 rounded-md text-on-surface-variant hover:bg-surface-container hover:text-primary disabled:opacity-40 border-0 bg-transparent cursor-pointer"
          >
            <FolderOpen className="w-4 h-4" />
          </button>
        </div>
        <p className="font-mono text-xs break-all text-on-surface-variant">
          {status.data?.dataDir ?? "加载中…"}
        </p>
        <p className="text-xs text-on-surface-variant/70">文献、会话和配置都保存在此目录。</p>
      </section>
    </div>
  );
}
