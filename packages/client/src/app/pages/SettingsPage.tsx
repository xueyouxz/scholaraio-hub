import {
  DEFAULT_PROVIDER,
  type NewSessionDefaults,
  PROVIDER_NAMES,
  type ProviderUsageLimits,
} from "@scholaraio-hub/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, FolderOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { readStoredJson, writeStoredJson } from "../../core/browserStorage";
import { libraryApi } from "../../core/library";
import { providersApi, providersQuery } from "../../core/providers";
import { appSettingsQuery, settingsApi } from "../../core/settings";
import { LibrarySettingsForm } from "../../features/library/components/LibrarySettingsForm";
import { usePageTitle } from "../components/NavigationLayout";
import { UsageLimitBlock, describeProvider } from "../components/ProviderUsage";

/**
 * The agents' usage as it last looked, so reopening the page shows the bars at
 * once and a fresh answer only moves them. A per-browser convenience: without
 * it the bars simply start empty. (The agents themselves start from the last
 * list `providersQuery` keeps.)
 */
const REMEMBERED_KEY = "hub-settings:agent-status";

interface RememberedStatus {
  usageLimits?: ProviderUsageLimits[];
}

function readRemembered(): RememberedStatus {
  return readStoredJson<RememberedStatus>(REMEMBERED_KEY, {});
}

function remember(patch: RememberedStatus) {
  writeStoredJson(REMEMBERED_KEY, { ...readRemembered(), ...patch });
}

export function SettingsPage() {
  const { setTitle } = usePageTitle();
  const client = useQueryClient();
  useEffect(() => {
    setTitle("Settings");
    return () => setTitle("");
  }, [setTitle]);
  const settings = useQuery({
    ...appSettingsQuery,
  });
  const library = useQuery({
    queryKey: ["library", "settings"],
    queryFn: ({ signal }) => libraryApi.settings(signal),
  });
  const [remembered] = useState(readRemembered);
  const providers = useQuery(providersQuery);
  const usage = useQuery({
    queryKey: ["provider-usage-limits"],
    queryFn: ({ signal }) => providersApi.usageLimits(signal),
    staleTime: 60_000,
    // The server holds each answer for minutes; asking again is cheap and silent.
    refetchInterval: 60_000,
    placeholderData: remembered.usageLimits ? { usageLimits: remembered.usageLimits } : undefined,
  });
  useEffect(() => {
    if (usage.data && !usage.isPlaceholderData) remember({ usageLimits: usage.data.usageLimits });
  }, [usage.data, usage.isPlaceholderData]);
  const save = useMutation({
    mutationFn: settingsApi.save,
    onSuccess: (data) => client.setQueryData(appSettingsQuery.queryKey, data),
  });
  const openDirectory = useMutation({ mutationFn: libraryApi.revealDirectory });
  const defaults = settings.data?.settings.newSessionDefaults;
  const providerName = defaults?.provider ?? DEFAULT_PROVIDER;
  const update = (value: NewSessionDefaults) => {
    save.mutate({ ...defaults, ...value });
  };
  const error = settings.error ?? providers.error ?? save.error;
  return (
    <div className="w-full max-w-3xl mx-auto pt-1 pb-6 flex flex-col gap-7">
      <section className="space-y-2" aria-labelledby="default-agent">
        <div className="flex items-center gap-3">
          <h2
            id="default-agent"
            className="text-[10px] font-mono font-bold uppercase tracking-widest text-on-surface-variant"
          >
            默认 AI 工具
          </h2>
          {save.isSuccess ? <output className="text-[11px] text-primary">设置已保存</output> : null}
        </div>
        <fieldset className="grid md:grid-cols-2 gap-3" aria-label="默认 AI 工具">
          {PROVIDER_NAMES.map((name) => {
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
                      {describeProvider(item, providers.isLoading)}
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
                  provider={item}
                  limits={usage.data?.usageLimits.find((limit) => limit.provider === name) ?? null}
                  loading={usage.isLoading}
                />
              </button>
            );
          })}
        </fieldset>
      </section>
      {error ? (
        <p role="alert" className="text-error break-words">
          {error.message}
        </p>
      ) : null}
      <LibrarySettingsForm />
      <section aria-labelledby="storage" className="space-y-2">
        <h2
          id="storage"
          className="text-[10px] font-mono font-bold uppercase tracking-widest text-on-surface-variant"
        >
          存储位置
        </h2>
        <div className="divide-y divide-outline-variant/10 overflow-hidden rounded-xl border border-outline-variant/15 bg-surface-container-low">
          {(
            [
              { target: "papers", label: "文献存储目录", path: library.data?.papersDir },
              { target: "workspaces", label: "文献集合目录", path: library.data?.workspaceDir },
            ] as const
          ).map((row) => (
            <div key={row.target} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-on-surface">{row.label}</p>
                <p className="mt-0.5 font-mono text-[11px] break-all text-on-surface-variant">
                  {row.path ?? (library.error ? "文献服务不可用" : "加载中…")}
                </p>
              </div>
              <button
                type="button"
                aria-label={`在文件管理器中打开${row.label}`}
                title="在文件管理器中打开"
                disabled={openDirectory.isPending || !row.path}
                onClick={() => openDirectory.mutate(row.target)}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container hover:text-primary disabled:opacity-40"
              >
                <FolderOpen className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
        {openDirectory.error ? (
          <p role="alert" className="px-1 text-xs text-error">
            {openDirectory.error.message}
          </p>
        ) : null}
      </section>
    </div>
  );
}
