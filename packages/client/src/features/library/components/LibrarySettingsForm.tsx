import type { LibrarySettings } from "@scholaraio-hub/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { libraryApi } from "../../../core/library";

type Choice = { field: keyof LibrarySettings; label: string; options: string[]; hint?: string };

const CHOICES: Choice[] = [
  {
    field: "pdfParser",
    label: "PDF 解析器",
    options: ["mineru", "docling", "pymupdf"],
    hint: "MinerU 需要 token，未配置时自动降级为本地解析器。",
  },
  {
    field: "extractor",
    label: "元数据提取",
    options: ["robust", "auto", "llm", "regex"],
    hint: "robust 与 llm 需要 LLM API Key，没有 key 时导入按 regex 运行。",
  },
  { field: "llmBackend", label: "LLM 协议", options: ["openai-compat", "anthropic", "google"] },
  { field: "embedProvider", label: "嵌入后端", options: ["local", "openai-compat", "none"] },
  { field: "embedSource", label: "模型下载源", options: ["modelscope", "huggingface"] },
  { field: "embedDevice", label: "推理设备", options: ["auto", "cpu", "cuda"] },
];

const TEXTS: { field: keyof LibrarySettings; label: string; placeholder: string }[] = [
  { field: "llmModel", label: "LLM 模型", placeholder: "deepseek-chat" },
  { field: "llmBaseUrl", label: "LLM 地址", placeholder: "https://api.deepseek.com" },
  { field: "embedModel", label: "嵌入模型", placeholder: "Qwen/Qwen3-Embedding-0.6B" },
];

const KEYS: { field: string; label: string; configured: keyof LibrarySettings }[] = [
  { field: "mineruApiKey", label: "MinerU Token", configured: "mineruConfigured" },
  { field: "llmApiKey", label: "LLM API Key", configured: "llmConfigured" },
  { field: "embedApiKey", label: "嵌入 API Key", configured: "embedApiConfigured" },
];

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
  const value = (field: keyof LibrarySettings) =>
    draft[field] ?? (current ? String(current[field] ?? "") : "");
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
        className="space-y-4 rounded-xl bg-surface-container-low border border-outline-variant/15 p-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (Object.keys(draft).length) save.mutate(draft);
        }}
      >
        <div className="grid gap-3 md:grid-cols-2">
          {CHOICES.map(({ field, label, options, hint }) => (
            <label key={field} className="text-sm">
              {label}
              <select
                className="hub-input w-full block mt-2"
                disabled={!current || save.isPending}
                value={value(field)}
                onChange={(event) => setDraft((d) => ({ ...d, [field]: event.target.value }))}
              >
                {options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              {hint ? (
                <span className="block mt-1 text-xs text-on-surface-variant">{hint}</span>
              ) : null}
            </label>
          ))}
          {TEXTS.map(({ field, label, placeholder }) => (
            <label key={field} className="text-sm">
              {label}
              <input
                className="hub-input w-full block mt-2"
                disabled={!current || save.isPending}
                value={value(field)}
                placeholder={placeholder}
                onChange={(event) => setDraft((d) => ({ ...d, [field]: event.target.value }))}
              />
            </label>
          ))}
          {KEYS.map(({ field, label, configured }) => (
            <label key={field} className="text-sm">
              {label}
              <input
                type="password"
                autoComplete="off"
                className="hub-input w-full block mt-2"
                disabled={!current || save.isPending}
                value={draft[field] ?? ""}
                placeholder={current?.[configured] ? "已配置，输入可替换" : "尚未配置"}
                onChange={(event) => setDraft((d) => ({ ...d, [field]: event.target.value }))}
              />
            </label>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            className="hub-button"
            type="submit"
            disabled={!current || save.isPending || Object.keys(draft).length === 0}
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
