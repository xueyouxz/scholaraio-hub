import type { LibrarySettings } from "@scholaraio-hub/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { libraryApi } from "../../../core/library";
import { ChipGroup } from "../../../shared/ui/ChipGroup";
import { CapabilityPrompt } from "./CapabilityPrompt";

type Field =
  | {
      kind: "choice";
      field: keyof LibrarySettings;
      label: string;
      options: string[];
      hint?: string;
    }
  | { kind: "text"; field: keyof LibrarySettings; label: string; placeholder: string }
  | { kind: "secret"; field: string; label: string; configured: keyof LibrarySettings };

/** The settings that make up one job, and what that job can do right now. */
interface Group {
  title: string;
  purpose: string;
  status: (settings: LibrarySettings) => string;
  fields: Field[];
}

const GROUPS: Group[] = [
  {
    title: "解析",
    purpose: "把 PDF 变成可检索的正文。",
    status: (settings) =>
      settings.mineruConfigured
        ? "MinerU 已配置 · 云端解析"
        : "MinerU 未配置 · 导入时降级为本地解析器",
    fields: [
      {
        kind: "choice",
        field: "pdfParser",
        label: "PDF 解析器",
        options: ["mineru", "docling", "pymupdf"],
      },
      {
        kind: "secret",
        field: "mineruApiKey",
        label: "MinerU Token",
        configured: "mineruConfigured",
      },
    ],
  },
  {
    title: "元数据与深度解析",
    purpose: "提取标题、作者、摘要，以及每篇论文的目录与结论。",
    status: (settings) =>
      settings.llmConfigured ? "LLM 已配置" : "LLM 未配置 · 导入按 regex 提取，深度解析不可用",
    fields: [
      {
        kind: "choice",
        field: "extractor",
        label: "元数据提取",
        options: ["robust", "auto", "llm", "regex"],
        hint: "robust 与 llm 需要 LLM API Key。",
      },
      {
        kind: "choice",
        field: "llmBackend",
        label: "LLM 协议",
        options: ["openai-compat", "anthropic", "google"],
      },
      { kind: "text", field: "llmModel", label: "LLM 模型", placeholder: "deepseek-chat" },
      {
        kind: "text",
        field: "llmBaseUrl",
        label: "LLM 地址",
        placeholder: "https://api.deepseek.com",
      },
      { kind: "secret", field: "llmApiKey", label: "LLM API Key", configured: "llmConfigured" },
    ],
  },
  {
    title: "语义检索",
    purpose: "按意思检索，以及主题地图所依赖的向量。",
    status: (settings) =>
      settings.embedProvider === "none"
        ? "已关闭向量嵌入 · 语义检索与主题地图不可用"
        : settings.embedProvider === "local"
          ? `本地模型 ${settings.embedModel}`
          : `远程嵌入服务${settings.embedApiConfigured ? " · 已配置 Key" : " · 尚未配置 Key"}`,
    fields: [
      {
        kind: "choice",
        field: "embedProvider",
        label: "嵌入后端",
        options: ["local", "openai-compat", "none"],
      },
      {
        kind: "text",
        field: "embedModel",
        label: "嵌入模型",
        placeholder: "Qwen/Qwen3-Embedding-0.6B",
      },
      {
        kind: "choice",
        field: "embedSource",
        label: "模型下载源",
        options: ["modelscope", "huggingface"],
      },
      { kind: "choice", field: "embedDevice", label: "推理设备", options: ["auto", "cpu", "cuda"] },
      {
        kind: "secret",
        field: "embedApiKey",
        label: "嵌入 API Key",
        configured: "embedApiConfigured",
      },
    ],
  },
];

/** The choices, plus whatever config.yaml already says if it is not among them. */
function withCurrent(options: string[], current: string): string[] {
  return current && !options.includes(current) ? [...options, current] : options;
}

/** The library settings a user would otherwise have to edit config.yaml for. */
export function LibrarySettingsForm() {
  const client = useQueryClient();
  const settings = useQuery({
    queryKey: ["library", "settings"],
    queryFn: ({ signal }) => libraryApi.settings(signal),
  });
  const [draft, setDraft] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: libraryApi.saveSettings,
    onSuccess: (data) => {
      client.setQueryData(["library", "settings"], data);
      void client.invalidateQueries({ queryKey: ["library", "capabilities"] });
      setDraft({});
    },
  });
  const current = settings.data;
  const edit = (field: string, value: string) => setDraft((d) => ({ ...d, [field]: value }));
  const forget = (field: string) =>
    setDraft((d) => {
      const { [field]: _dropped, ...rest } = d;
      return rest;
    });
  const value = (field: keyof LibrarySettings) =>
    draft[field] ?? (current ? String(current[field] ?? "") : "");
  const disabled = !current || save.isPending;
  return (
    <section className="space-y-3">
      <h2 className="text-[10px] font-mono uppercase tracking-widest text-on-surface-variant">
        Library
      </h2>
      <p className="text-sm text-on-surface-variant">
        文献解析与检索使用的服务。密钥只写入本机配置，不会回显。
      </p>
      {settings.error ? (
        <p role="alert" className="text-error break-words">
          {settings.error.message}
        </p>
      ) : null}
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (Object.keys(draft).length) save.mutate(draft);
        }}
      >
        {GROUPS.map((group) => (
          <fieldset
            key={group.title}
            className="space-y-3 rounded-xl bg-surface-container-low border border-outline-variant/15 p-4"
          >
            <legend className="font-serif text-base font-semibold text-on-surface px-1">
              {group.title}
            </legend>
            <p className="text-xs text-on-surface-variant">{group.purpose}</p>
            {current ? (
              <p className="text-[10px] font-mono uppercase tracking-wider text-primary">
                {group.status(current)}
              </p>
            ) : null}
            <div className="grid gap-3 md:grid-cols-2">
              {group.fields.map((item) =>
                item.kind === "choice" ? (
                  <ChipGroup
                    key={item.field}
                    label={item.label}
                    hint={item.hint}
                    value={value(item.field)}
                    options={withCurrent(item.options, value(item.field)).map((option) => ({
                      value: option,
                    }))}
                    disabled={disabled}
                    onChange={(next) => edit(item.field, next)}
                  />
                ) : item.kind === "text" ? (
                  <label key={item.field} className="flex flex-col gap-1.5">
                    <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-on-surface-variant">
                      {item.label}
                    </span>
                    <input
                      className="rounded-xl border border-outline-variant/20 bg-surface-container px-3 py-2 text-[13px] text-on-surface outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-40"
                      disabled={disabled}
                      value={value(item.field)}
                      placeholder={item.placeholder}
                      onChange={(event) => edit(item.field, event.target.value)}
                    />
                  </label>
                ) : (
                  <SecretField
                    key={item.field}
                    item={item}
                    settings={current}
                    disabled={disabled}
                    draft={draft[item.field]}
                    onChange={(next) => edit(item.field, next)}
                    onKeep={() => forget(item.field)}
                  />
                ),
              )}
            </div>
            {group.title === "语义检索" ? <CapabilityPrompt kind="semantic" /> : null}
          </fieldset>
        ))}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={disabled || Object.keys(draft).length === 0}
            className="signature-gradient rounded-full px-4 py-2 text-sm font-semibold text-on-primary active:scale-95 disabled:opacity-40 border-0 cursor-pointer"
          >
            保存
          </button>
          {save.isSuccess && Object.keys(draft).length === 0 ? (
            <output className="text-sm text-primary">已保存</output>
          ) : null}
          {save.error ? (
            <p role="alert" className="text-sm text-error break-words">
              {save.error.message}
            </p>
          ) : null}
        </div>
        {current ? (
          <p className="text-xs text-on-surface-variant break-all">
            其余配置项可直接编辑 {current.configPath}
          </p>
        ) : null}
      </form>
    </section>
  );
}

/**
 * A key the browser may set but never read back.
 *
 * An empty box means "leave it alone", so clearing a stored key needs to be
 * something the user can say: the button says it, and saving removes the key
 * from the overlay.
 */
function SecretField({
  item,
  settings,
  disabled,
  draft,
  onChange,
  onKeep,
}: {
  item: { field: string; label: string; configured: keyof LibrarySettings };
  settings?: LibrarySettings;
  disabled: boolean;
  draft?: string;
  onChange: (value: string) => void;
  onKeep: () => void;
}) {
  const configured = Boolean(settings?.[item.configured]);
  const clearing = draft === "";
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-on-surface-variant">
        {item.label}
      </span>
      <input
        type="password"
        autoComplete="off"
        className="rounded-xl border border-outline-variant/20 bg-surface-container px-3 py-2 text-[13px] text-on-surface outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-40"
        disabled={disabled}
        value={draft ?? ""}
        placeholder={configured ? "已配置，输入可替换" : "尚未配置"}
        onChange={(event) => onChange(event.target.value)}
      />
      {configured ? (
        <button
          type="button"
          className="self-start text-[10px] font-mono font-bold text-on-surface-variant hover:text-error disabled:opacity-40 border-0 bg-transparent cursor-pointer p-0"
          disabled={disabled}
          onClick={() => (clearing ? onKeep() : onChange(""))}
        >
          {clearing ? "保存后清除 · 点此取消" : "清除已存的密钥"}
        </button>
      ) : null}
    </label>
  );
}
