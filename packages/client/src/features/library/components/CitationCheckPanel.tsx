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
      <summary className="cursor-pointer text-[10px] font-mono font-bold uppercase tracking-widest text-on-surface-variant hover:text-primary">
        核查正文引用
      </summary>
      <div className="mt-2 flex flex-col gap-3">
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (draft.trim()) check.mutate();
          }}
        >
          <label className="flex flex-col gap-1.5">
            <span className="sr-only">正文</span>
            <textarea
              className="h-24 w-full resize-none rounded-xl border border-outline-variant/20 bg-surface-container px-3 py-2 text-[13px] text-on-surface outline-none focus:ring-2 focus:ring-primary/20"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="粘贴正文，检查其中的 作者（年份）引用是否在库中…"
            />
          </label>
          <button
            type="submit"
            className="self-start rounded-full bg-surface-container-high px-3 py-1.5 text-sm font-medium text-on-surface active:scale-95 disabled:opacity-40 border-0 cursor-pointer"
            disabled={check.isPending || !draft.trim()}
          >
            {check.isPending ? "核查中…" : "核查引用"}
          </button>
        </form>
        {check.error ? (
          <p role="alert" className="text-xs text-error">
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
