import type { NewSessionDefaults, StoredSession } from "@scholaraio-hub/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { requestJson } from "../../core/http";
import { settingsApi } from "../../core/library";
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
  const navigate = useNavigate();
  const history = useMutation({
    mutationFn: async (file: File) =>
      requestJson<StoredSession>("/api/sessions/import", {
        method: "POST",
        body: JSON.stringify({
          provider: providerName,
          title: file.name,
          content: await file.text(),
        }),
      }),
    onSuccess: (session) => {
      void client.invalidateQueries({ queryKey: ["sessions"] });
      navigate(`/sessions/${session.id}`);
    },
  });
  const defaults = settings.data?.settings.newSessionDefaults;
  const providerName = defaults?.provider === "codex" ? "codex" : "claude";
  const provider = providers.data?.providers.find((item) => item.name === providerName);
  const [modelDraft, setModelDraft] = useState<string | null>(null);
  const update = (value: NewSessionDefaults) => {
    save.mutate({ ...defaults, ...value });
  };
  const error = settings.error ?? providers.error ?? save.error ?? status.error ?? history.error;
  return (
    <div className="w-full max-w-3xl mx-auto pt-3 pb-6 flex flex-col gap-6">
      <section className="space-y-4">
        <h1 className="text-[10px] font-mono uppercase tracking-widest text-on-surface-variant">
          Agent
        </h1>
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
                onClick={() => {
                  setModelDraft(null);
                  update({ provider: name, model: undefined });
                }}
                className={`relative block w-full rounded-2xl border overflow-hidden text-left transition-colors ${providerName === name ? "border-primary/30 bg-primary/5 shadow-sm" : "border-outline-variant/20 bg-surface-container-low hover:bg-surface-container"}`}
              >
                <span className="relative flex w-full items-center gap-3 px-4 py-3.5">
                  <img
                    src={`/icons/${name === "claude" ? "claudecode" : "codex"}-color.svg`}
                    width={36}
                    height={36}
                    alt=""
                    className="w-9 h-9 shrink-0 rounded-lg object-contain"
                  />
                  <span className="min-w-0 flex-1 pr-6">
                    <span className="block text-sm font-semibold text-on-surface">
                      {name === "claude" ? "Claude Code" : "Codex"}
                    </span>
                    <span className="block text-[10px] font-mono text-on-surface-variant/60 truncate mt-0.5">
                      {providers.isLoading
                        ? "检测中…"
                        : !item
                          ? "当前环境未启用"
                          : !item.installed
                            ? "未找到可用的 CLI"
                            : item.authenticated
                              ? "已安装并登录"
                              : "已安装，尚未登录"}
                    </span>
                    {item?.user?.email ? (
                      <span className="block text-xs truncate mt-2">{item.user.email}</span>
                    ) : null}
                  </span>
                </span>
                {providerName === name ? (
                  <CheckCircle2
                    className="absolute top-3 right-3 w-4 h-4 text-primary"
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
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            update({
              provider: providerName,
              model: (modelDraft ?? defaults?.model ?? "").trim() || undefined,
            });
          }}
        >
          <label className="flex-1 min-w-40 text-sm">
            默认模型
            <input
              name="model"
              list="settings-models"
              className="hub-input w-full block mt-2"
              value={modelDraft ?? defaults?.model ?? ""}
              onChange={(e) => setModelDraft(e.target.value)}
              placeholder="使用 CLI 默认模型…"
            />
            <datalist id="settings-models">
              {provider?.models?.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </datalist>
          </label>
          <button className="hub-button" disabled={!settings.data || save.isPending} type="submit">
            保存模型
          </button>
          <button
            className="hub-button"
            disabled={providers.isFetching}
            type="button"
            onClick={() => void providers.refetch()}
          >
            重新检测
          </button>
        </form>
        <p className="text-xs text-on-surface-variant">
          {providerName === "claude"
            ? "在终端运行 claude auth login 完成登录。"
            : "在终端运行 codex login 完成登录。"}
        </p>
        {save.isSuccess ? <output className="text-sm text-primary">设置已保存</output> : null}
      </section>
      {error ? (
        <p role="alert" className="text-error break-words">
          {error.message}
        </p>
      ) : null}
      <section className="space-y-3">
        <h2 className="text-[10px] font-mono uppercase tracking-widest text-on-surface-variant">
          History
        </h2>
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 rounded-xl bg-surface-container-low border border-outline-variant/15">
          <p className="flex-1 min-w-48 text-xs text-on-surface-variant">
            导入 {providerName === "claude" ? "Claude Code" : "Codex"} 的 JSONL
            历史，作为只读会话查看。
          </p>
          <label className="hub-button cursor-pointer">
            选择历史文件
            <input
              className="sr-only"
              type="file"
              accept=".jsonl"
              disabled={history.isPending}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) history.mutate(file);
                e.target.value = "";
              }}
            />
          </label>
        </div>
      </section>
      <section className="rounded-xl bg-surface-container-low p-5 space-y-2">
        <h2 className="text-lg">本地环境</h2>
        <p className="text-xs text-on-surface-variant">数据目录</p>
        <p className="font-mono text-sm break-all">{status.data?.dataDir ?? "加载中…"}</p>
        <p className="text-sm text-on-surface-variant">
          当前环境：{status.data?.profile ?? "加载中…"}。文献、会话和配置保存在此目录。
        </p>
      </section>
    </div>
  );
}
