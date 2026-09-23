import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { libraryApi } from "../../../core/library";

const FORMATS = [
  { value: "bibtex", label: "BibTeX" },
  { value: "ris", label: "RIS" },
  { value: "markdown", label: "Markdown 参考文献" },
];
const STYLES = ["apa", "vancouver", "chicago-author-date", "mla"];
const STATUS_LABELS: Record<string, string> = {
  VERIFIED: "已核实",
  AMBIGUOUS: "多篇匹配",
  NOT_IN_LIBRARY: "库中没有",
};

/** Save the current selection's references, and check a draft against them. */
export function ReferenceTools({
  paperIds,
  projectId,
}: {
  paperIds: string[];
  projectId?: string;
}) {
  const [format, setFormat] = useState("bibtex");
  const [style, setStyle] = useState("apa");
  const [draft, setDraft] = useState("");
  const save = useMutation({
    mutationFn: () => libraryApi.exportReferences({ paperIds, projectId, format, style }),
    onSuccess: (file) => {
      const url = URL.createObjectURL(new Blob([file.content], { type: file.contentType }));
      const link = document.createElement("a");
      link.href = url;
      link.download = file.filename;
      link.click();
      URL.revokeObjectURL(url);
    },
  });
  const check = useMutation({ mutationFn: () => libraryApi.checkCitations(draft, projectId) });
  const report = check.data;
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-primary">引用工具</summary>
      <div className="mt-2 flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            导出格式
            <select
              className="hub-input block mt-1"
              value={format}
              onChange={(event) => setFormat(event.target.value)}
            >
              {FORMATS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {format === "markdown" ? (
            <label className="text-sm">
              引用风格
              <select
                className="hub-input block mt-1"
                value={style}
                onChange={(event) => setStyle(event.target.value)}
              >
                {STYLES.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <button
            type="button"
            className="hub-button"
            disabled={save.isPending}
            onClick={() => save.mutate()}
          >
            {paperIds.length ? `导出选中的 ${paperIds.length} 篇` : "导出当前范围"}
          </button>
        </div>
        {save.error ? (
          <p role="alert" className="text-error">
            {save.error.message}
          </p>
        ) : null}
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (draft.trim()) check.mutate();
          }}
        >
          <label className="text-sm">
            核查正文引用
            <textarea
              className="hub-input w-full block mt-1 h-24"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="粘贴正文，检查其中的 作者（年份）引用是否在库中…"
            />
          </label>
          <button
            type="submit"
            className="hub-button self-start"
            disabled={check.isPending || !draft.trim()}
          >
            {check.isPending ? "核查中…" : "核查引用"}
          </button>
        </form>
        {check.error ? (
          <p role="alert" className="text-error">
            {check.error.message}
          </p>
        ) : null}
        {report ? (
          <div className="flex flex-col gap-1">
            <p className="text-xs text-on-surface-variant">
              已核实 {report.verified} · 多篇匹配 {report.ambiguous} · 库中没有 {report.missing}
            </p>
            <ul className="flex flex-col gap-1">
              {report.citations.map((citation) => (
                <li key={citation.raw} className="text-xs font-mono">
                  <span
                    className={
                      citation.status === "VERIFIED" ? "text-primary" : "text-on-surface-variant"
                    }
                  >
                    {STATUS_LABELS[citation.status] ?? citation.status}
                  </span>{" "}
                  {citation.raw}
                  {citation.matches[0] ? ` · ${citation.matches[0].title}` : ""}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </details>
  );
}
