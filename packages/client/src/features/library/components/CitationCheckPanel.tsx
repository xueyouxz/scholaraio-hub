import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { libraryApi } from "../../../core/library";

const STATUS_LABELS: Record<string, string> = {
  VERIFIED: "已核实",
  AMBIGUOUS: "多篇匹配",
  NOT_IN_LIBRARY: "库中没有",
};

/** Check the citations in a draft against what the library actually holds. */
export function CitationCheckPanel({ projectId }: { projectId?: string }) {
  const [draft, setDraft] = useState("");
  const check = useMutation({ mutationFn: () => libraryApi.checkCitations(draft, projectId) });
  const report = check.data;
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-primary">核查正文引用</summary>
      <div className="mt-2 flex flex-col gap-3">
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (draft.trim()) check.mutate();
          }}
        >
          <label className="text-sm">
            正文
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
