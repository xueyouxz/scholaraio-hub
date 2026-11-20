import type { LibrarySettings, SettingsCheck } from "@scholaraio-hub/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Brain,
  Check,
  CheckCircle2,
  ExternalLink,
  FileText,
  Loader2,
  RefreshCw,
  Sparkles,
  XCircle,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { libraryApi } from "../../../core/library";
import { CapabilityPrompt } from "./CapabilityPrompt";

type Target = SettingsCheck["target"];

/** How long typing may pause before the field saves itself. */
const SAVE_DELAY_MS = 800;

/** Where each LLM provider hands out API keys, by the host of its API address. */
const KEY_PAGES: [RegExp, string][] = [
  [/deepseek\.com$/, "https://platform.deepseek.com/api_keys"],
  [/openai\.com$/, "https://platform.openai.com/api-keys"],
  [/anthropic\.com$/, "https://console.anthropic.com/settings/keys"],
  [/bigmodel\.cn$/, "https://open.bigmodel.cn/usercenter/apikeys"],
  [/moonshot\.(cn|ai)$/, "https://platform.moonshot.cn/console/api-keys"],
  [/siliconflow\.(cn|com)$/, "https://cloud.siliconflow.cn/account/ak"],
  [/(dashscope|aliyuncs)\.com$/, "https://bailian.console.aliyun.com/?apiKey=1"],
  [/googleapis\.com$/, "https://aistudio.google.com/app/apikey"],
];

export function keyPage(baseUrl: string): string | null {
  try {
    const url = new URL(baseUrl);
    return KEY_PAGES.find(([host]) => host.test(url.hostname))?.[1] ?? url.origin;
  } catch {
    return null;
  }
}

function modelPage(settings: LibrarySettings): string | null {
  const model = settings.embedModel.trim();
  if (settings.embedProvider !== "local" || !model.includes("/")) return null;
  return settings.embedSource === "huggingface"
    ? `https://huggingface.co/${model}`
    : `https://modelscope.cn/models/${model}`;
}

/**
 * The services the library leans on, in one place: parsing, the language
 * model, and the embedding model.
 *
 * Every field saves itself — after a pause in typing, or on leaving it — and
 * each service can be tried once with what is saved, so the user learns that
 * a key works here instead of at the next import.
 */
export function LibrarySettingsForm() {
  const settings = useQuery({
    queryKey: ["library", "settings"],
    queryFn: ({ signal }) => libraryApi.settings(signal),
  });
  const current = settings.data;
  // A save that changes a service asks that service to be tried again.
  const [recheck, setRecheck] = useState<Record<Target, number>>({ mineru: 0, llm: 0, embed: 0 });
  const saved = (target: Target) =>
    setRecheck((previous) => ({ ...previous, [target]: previous[target] + 1 }));

  if (settings.error)
    return (
      <p role="alert" className="text-sm text-error break-words">
        文献服务设置不可用：{settings.error.message}
      </p>
    );
  if (!current)
    return <div className="h-72 rounded-xl skeleton-shimmer opacity-50" aria-label="加载中" />;
  const llmKeys = keyPage(current.llmBaseUrl || "https://api.deepseek.com");
  const apiEmbedding = current.embedProvider === "openai-compat";
  const embedPage = apiEmbedding ? keyPage(current.embedApiBase) : modelPage(current);
  return (
    <section aria-labelledby="library-services" className="space-y-2">
      <h2
        id="library-services"
        className="text-[10px] font-mono font-bold uppercase tracking-widest text-on-surface-variant"
      >
        文献服务
      </h2>
      <div className="divide-y divide-outline-variant/10 overflow-hidden rounded-xl border border-outline-variant/15 bg-surface-container-low">
        <Service
          target="mineru"
          icon={FileText}
          title="PDF 解析"
          summary="连接本地 MinerU，或使用云端 Token"
          configured={Boolean(current.mineruEndpoint) || current.mineruConfigured}
          recheck={recheck.mineru}
          autoCheck
          link={{ href: "https://mineru.net/apiManage/token", label: "获取 Token" }}
        >
          {(checkButton) => (
            <>
              <TextSetting
                field="mineruEndpoint"
                label="本地 MinerU 地址"
                placeholder="http://host.docker.internal:18000…"
                value={current.mineruEndpoint}
                onSaved={() => saved("mineru")}
                addon={checkButton}
              />
              <TextSetting
                field="mineruBackend"
                label="本地解析档位（flash / basic；旧版用 pipeline）"
                placeholder="basic…"
                value={current.mineruBackend}
                onSaved={() => saved("mineru")}
              />
              <SecretSetting
                field="mineruApiKey"
                label="云端 MinerU Token（可选）"
                storedLength={current.mineruKeyLength}
                onSaved={() => saved("mineru")}
              />
            </>
          )}
        </Service>
        <Service
          target="llm"
          icon={Brain}
          title="元数据与深度解析"
          summary={current.llmConfigured ? undefined : "LLM · 未配置时按规则提取"}
          configured={current.llmConfigured}
          recheck={recheck.llm}
          link={llmKeys ? { href: llmKeys, label: "获取 API Key" } : undefined}
        >
          {(checkButton) => (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <TextSetting
                  field="llmModel"
                  label="模型"
                  placeholder="deepseek-chat"
                  value={current.llmModel}
                  onSaved={() => saved("llm")}
                />
                <TextSetting
                  field="llmBaseUrl"
                  label="API 地址"
                  placeholder="https://api.deepseek.com"
                  value={current.llmBaseUrl}
                  onSaved={() => saved("llm")}
                />
              </div>
              <SecretSetting
                field="llmApiKey"
                label="API Key"
                storedLength={current.llmKeyLength}
                onSaved={() => saved("llm")}
                addon={checkButton}
              />
            </>
          )}
        </Service>
        <Service
          key={current.embedProvider}
          target="embed"
          icon={Sparkles}
          title="语义检索"
          summary={apiEmbedding ? "通过 Embedding API 生成向量" : "在服务器上运行嵌入模型"}
          configured={current.embedProvider !== "none"}
          recheck={apiEmbedding ? 0 : recheck.embed}
          autoCheck={!apiEmbedding}
          link={
            embedPage
              ? { href: embedPage, label: apiEmbedding ? "获取 API Key" : "模型主页" }
              : undefined
          }
        >
          {(checkButton) => (
            <>
              <SelectSetting
                field="embedProvider"
                label="向量生成方式"
                value={current.embedProvider}
                options={[
                  { value: "local", label: "本地模型" },
                  { value: "openai-compat", label: "API（兼容 OpenAI）" },
                  { value: "none", label: "停用" },
                ]}
                onSaved={() => saved("embed")}
              />
              {current.embedProvider !== "none" ? (
                <>
                  <TextSetting
                    field="embedModel"
                    label={apiEmbedding ? "Embedding 模型名称" : "嵌入模型"}
                    placeholder={
                      apiEmbedding ? "填写服务商提供的嵌入模型名称" : "Qwen/Qwen3-Embedding-0.6B"
                    }
                    value={current.embedModel}
                    onSaved={() => saved("embed")}
                    addon={apiEmbedding ? undefined : checkButton}
                  />
                  {apiEmbedding ? (
                    <>
                      <TextSetting
                        field="embedApiBase"
                        label="Embedding API 地址"
                        placeholder="https://服务商地址/v1"
                        value={current.embedApiBase}
                        onSaved={() => saved("embed")}
                      />
                      <SecretSetting
                        field="embedApiKey"
                        label="Embedding API Key"
                        storedLength={current.embedKeyLength}
                        onSaved={() => saved("embed")}
                        addon={checkButton}
                      />
                      <p className="text-xs text-on-surface-variant">
                        地址填写 API 基础路径，系统会追加 /embeddings。使用专门的嵌入模型；API
                        模式无需下载本地模型。
                        生成向量时会发送论文标题、摘要，检索时会发送查询文本。点击自检会发起一次简短
                        API 请求，可能产生少量费用。
                      </p>
                    </>
                  ) : null}
                  <p className="text-xs text-on-surface-variant">
                    更换生成方式、模型或 API
                    地址后，点击“准备语义检索”重新生成索引，避免混用不同模型的向量。
                  </p>
                  <CapabilityPrompt kind="semantic" hideWhenReady />
                </>
              ) : null}
            </>
          )}
        </Service>
      </div>
    </section>
  );
}

function Service({
  target,
  icon: Icon,
  title,
  summary,
  configured,
  recheck,
  autoCheck = false,
  link,
  children,
}: {
  target: Target;
  icon: typeof FileText;
  title: string;
  summary?: string;
  configured: boolean;
  /** Bumped by a save, so the service is tried again with what was saved. */
  recheck: number;
  /** Try it as soon as the page opens: only for checks that cost nothing. */
  autoCheck?: boolean;
  link?: { href: string; label: string };
  /** The fields, given the self-check button to set beside the field it proves. */
  children: (checkButton: React.ReactNode) => React.ReactNode;
}) {
  const check = useMutation({ mutationFn: () => libraryApi.checkSettings(target) });
  const run = useRef(check.mutate);
  run.current = check.mutate;
  // Tried on opening (when free) and again after each save of this service.
  const onOpen = autoCheck && configured;
  useEffect(() => {
    if (recheck === 0 && !onOpen) return;
    const timer = setTimeout(() => run.current(), recheck ? 400 : 0);
    return () => clearTimeout(timer);
  }, [recheck, onOpen]);
  return (
    <div className="grid gap-3 px-4 py-4 sm:grid-cols-[12rem_minmax(0,1fr)]">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-container text-primary">
          <Icon className="w-3.5 h-3.5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h3 className="font-sans text-[13px] font-semibold leading-tight text-on-surface">
            {title}
          </h3>
          {summary ? (
            <p className="mt-0.5 truncate text-[11px] text-on-surface-variant" title={summary}>
              {summary}
            </p>
          ) : null}
          {link ? (
            <a
              href={link.href}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
            >
              {link.label}
              <ExternalLink className="w-3 h-3" aria-hidden="true" />
            </a>
          ) : null}
        </div>
      </div>
      <div className="min-w-0 space-y-3">
        {children(
          <button
            type="button"
            onClick={() => check.mutate()}
            disabled={check.isPending}
            className="inline-flex h-[38px] shrink-0 items-center gap-1.5 rounded-xl bg-surface-container-high px-3 text-xs font-medium text-on-surface hover:bg-surface-container-highest active:scale-95 disabled:opacity-60"
          >
            <RefreshCw
              className={`w-3 h-3 ${check.isPending ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
            自检
          </button>,
        )}
        <div className="flex min-h-5 items-center">
          <CheckResult pending={check.isPending} result={check.data} error={check.error} />
        </div>
      </div>
    </div>
  );
}

function CheckResult({
  pending,
  result,
  error,
}: {
  pending: boolean;
  result?: SettingsCheck;
  error: Error | null;
}) {
  if (pending)
    return (
      <output className="flex items-center gap-1.5 text-xs text-on-surface-variant">
        <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
        正在检测…
      </output>
    );
  if (error)
    return (
      <output className="flex min-w-0 items-center gap-1.5 text-xs text-error">
        <XCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">{error.message}</span>
      </output>
    );
  if (!result) return <span className="text-xs text-on-surface-variant/60">尚未检测</span>;
  const look = {
    ok: { icon: CheckCircle2, tone: "text-primary" },
    warning: { icon: AlertTriangle, tone: "text-secondary" },
    error: { icon: XCircle, tone: "text-error" },
  }[result.level];
  return (
    <output
      className={`flex min-w-0 items-center gap-1.5 text-xs ${look.tone}`}
      title={result.message}
    >
      <look.icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate">{result.message}</span>
    </output>
  );
}

const inputClass =
  "w-full rounded-xl border border-outline-variant/20 bg-surface-container-lowest px-3 py-2 text-[13px] text-on-surface outline-none transition-shadow placeholder:text-on-surface-variant/40 focus:border-primary/30 focus:ring-2 focus:ring-primary/15";

/** One setting's save: the request, and what the field says about it. */
function useFieldSave(field: string, onSaved: () => void) {
  const client = useQueryClient();
  const save = useMutation({
    mutationFn: (value: string) => libraryApi.saveSettings({ [field]: value }),
    onSuccess: (data) => {
      client.setQueryData(["library", "settings"], data);
      void client.invalidateQueries({ queryKey: ["library", "capabilities"] });
      onSaved();
    },
  });
  return save;
}

function SaveState({
  dirty,
  save,
}: {
  dirty: boolean;
  save: { isPending: boolean; isSuccess: boolean; error: Error | null };
}) {
  if (save.isPending)
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-mono text-on-surface-variant">
        <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
        保存中
      </span>
    );
  if (save.error)
    return (
      <span className="truncate text-[10px] text-error" title={save.error.message}>
        {save.error.message}
      </span>
    );
  if (dirty)
    return <span className="text-[10px] font-mono text-on-surface-variant/60">未保存</span>;
  if (save.isSuccess)
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-mono text-primary">
        <Check className="w-3 h-3" aria-hidden="true" />
        已保存
      </span>
    );
  return null;
}

function FieldLabel({
  htmlFor,
  label,
  state,
}: { htmlFor: string; label: string; state: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <label
        htmlFor={htmlFor}
        className="text-[10px] font-mono font-bold uppercase tracking-widest text-on-surface-variant"
      >
        {label}
      </label>
      {state}
    </div>
  );
}

/** A choice is saved immediately, with the server value retained on failure. */
function SelectSetting({
  field,
  label,
  value,
  options,
  onSaved,
}: {
  field: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onSaved: () => void;
}) {
  const save = useFieldSave(field, onSaved);
  const id = `setting-${field}`;
  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel htmlFor={id} label={label} state={<SaveState dirty={false} save={save} />} />
      <select
        id={id}
        name={field}
        className={inputClass}
        value={value}
        disabled={save.isPending}
        onChange={(event) => save.mutate(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** A plain setting that saves after a pause in typing, and on leaving the field. */
function TextSetting({
  field,
  label,
  placeholder,
  value,
  onSaved,
  addon,
}: {
  field: string;
  label: string;
  placeholder: string;
  value: string;
  onSaved: () => void;
  /** Set to the right of the box, on its line. */
  addon?: React.ReactNode;
}) {
  const [draft, setDraft] = useState(value);
  const [dirty, setDirty] = useState(false);
  const save = useFieldSave(field, onSaved);
  const sent = useRef(value);
  const latest = useRef(value);
  latest.current = draft;
  // The server's value shows through whenever the user has nothing unsaved.
  useEffect(() => {
    if (dirty) return;
    sent.current = value;
    setDraft(value);
  }, [value, dirty]);
  const commit = (next: string) => {
    if (next.trim() === sent.current.trim()) {
      setDirty(false);
      return;
    }
    sent.current = next;
    save.mutate(next, {
      // Typing that went on while this was saving is still unsaved.
      onSettled: () => {
        if (latest.current === next) setDirty(false);
      },
    });
  };
  const commitLater = useRef(commit);
  commitLater.current = commit;
  useEffect(() => {
    if (!dirty) return;
    const timer = setTimeout(() => commitLater.current(draft), SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [draft, dirty]);
  const id = `setting-${field}`;
  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel htmlFor={id} label={label} state={<SaveState dirty={dirty} save={save} />} />
      <div className="flex items-center gap-2">
        <input
          id={id}
          name={field}
          autoComplete="off"
          spellCheck={false}
          className={inputClass}
          value={draft}
          placeholder={placeholder}
          onChange={(event) => {
            setDraft(event.target.value);
            setDirty(true);
          }}
          onBlur={() => {
            if (dirty) commit(draft);
          }}
        />
        {addon}
      </div>
    </div>
  );
}

/**
 * A key the browser may set but never read back.
 *
 * A stored key shows as a mask of its real length, so the box never looks
 * empty when it is not; focusing it clears the mask for a replacement. It
 * saves when the user leaves the field or presses Enter — never mid-way
 * through pasting — and leaving it empty keeps the stored key.
 */
function SecretSetting({
  field,
  label,
  storedLength,
  onSaved,
  addon,
}: {
  field: string;
  label: string;
  /** Length of the stored key; 0 when there is none. */
  storedLength: number;
  onSaved: () => void;
  addon?: React.ReactNode;
}) {
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const save = useFieldSave(field, onSaved);
  const commit = () => {
    const value = draft.trim();
    if (!value) return;
    save.mutate(value, { onSuccess: () => setDraft("") });
  };
  const masked = storedLength > 0 && !editing && !draft;
  const id = `setting-${field}`;
  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel
        htmlFor={id}
        label={label}
        state={<SaveState dirty={Boolean(draft)} save={save} />}
      />
      <div className="flex items-center gap-2">
        <input
          id={id}
          name={field}
          type="password"
          autoComplete="off"
          spellCheck={false}
          className={inputClass}
          // Only ever a run of bullets: the stored key itself never reaches the browser.
          value={masked ? "•".repeat(storedLength) : draft}
          placeholder={storedLength > 0 ? "输入新值即可替换" : "粘贴后按回车或移开焦点即保存"}
          onFocus={() => setEditing(true)}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            setEditing(false);
            commit();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              commit();
            }
          }}
        />
        {addon}
      </div>
    </div>
  );
}
