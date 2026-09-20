import type { ProviderInfo } from "@scholaraio-hub/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { requestJson } from "../../core/http";
import { usePageTitle } from "../components/NavigationLayout";

export function SettingsPage() {
  const { setTitle } = usePageTitle();
  useEffect(() => {
    setTitle("设置");
    return () => setTitle("");
  }, [setTitle]);
  const status = useQuery({
    queryKey: ["app-status"],
    queryFn: ({ signal }) =>
      requestJson<{ dataDir: string; profile: string }>("/api/status", { signal }),
  });
  const providers = useQuery({
    queryKey: ["providers"],
    queryFn: ({ signal }) =>
      requestJson<{ providers: ProviderInfo[] }>("/api/providers", { signal }),
    staleTime: 60_000,
  });
  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl text-primary">本地环境</h1>
      <section className="rounded-xl bg-surface-container-low p-5 space-y-2">
        <h2>数据目录</h2>
        <p className="font-mono text-sm break-all">{status.data?.dataDir ?? "加载中…"}</p>
        <p className="text-sm text-on-surface-variant">
          当前环境：{status.data?.profile}。文献、会话和应用配置保存在此目录。
        </p>
      </section>
      <section className="space-y-3">
        <div className="flex justify-between items-center">
          <h2>AI 工具</h2>
          <button
            className="hub-button"
            type="button"
            disabled={providers.isFetching}
            onClick={() => void providers.refetch()}
          >
            重新检测
          </button>
        </div>
        {providers.data?.providers.map((provider) => (
          <div key={provider.name} className="rounded-xl bg-surface-container-low p-5">
            <h3>{provider.displayName}</h3>
            <p className="text-sm mt-2">
              {provider.installed
                ? provider.authenticated
                  ? "已安装并登录"
                  : "已安装，尚未登录"
                : "未找到可用的 CLI"}
            </p>
            <p className="text-xs text-on-surface-variant mt-2">
              {provider.name === "claude"
                ? "在终端运行 claude auth login 完成登录。"
                : "在终端运行 codex login 完成登录。"}
            </p>
          </div>
        ))}
      </section>
      {(status.error ?? providers.error) ? (
        <p className="text-error" role="alert">
          {(status.error ?? providers.error)?.message}
        </p>
      ) : null}
      <p className="text-sm text-on-surface-variant">
        CLI 使用现有登录。应用只管理在这里创建的会话，不扫描外部历史。
      </p>
    </div>
  );
}
