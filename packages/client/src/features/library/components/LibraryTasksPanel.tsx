import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { libraryApi } from "../../../core/library";
import { CAPABILITIES } from "../tasks";
import { CapabilityPrompt } from "./CapabilityPrompt";

/** What each audit rule means, in the words the page speaks. */
const RULES: Record<string, string> = {
  invalid_json: "meta.json 无法解析",
  invalid_metadata: "元数据无法读取",
  missing_md: "缺少正文（paper.md）",
  missing_title: "缺少标题",
  missing_doi: "缺少 DOI",
  missing_abstract: "缺少摘要",
  missing_year: "缺少年份",
  missing_authors: "缺少作者",
  missing_journal: "缺少期刊",
  duplicate_doi: "DOI 与其他论文重复",
  garbled_title: "标题含乱码",
  placeholder_title: "标题疑似占位符",
  suspicious_author: "作者疑似有误",
  suspicious_year: "年份疑似有误",
  suspicious_dirname: "目录名与论文不一致",
};

const SEVERITY: Record<string, string> = { error: "错误", warning: "警告", info: "提示" };

/** Start, watch and stop the library work that costs model time. */
export function LibraryTasksPanel() {
  return (
    <section
      aria-label="文献库能力"
      className="shrink-0 bg-surface-container-low border border-outline-variant/10 rounded-lg p-3 flex flex-col gap-2"
    >
      <div className="grid gap-2 md:grid-cols-4">
        {CAPABILITIES.map((item) => (
          <CapabilityPrompt key={item.kind} kind={item.kind} />
        ))}
      </div>
      <AuditSummary />
    </section>
  );
}

/** What the library's own audit finds, once the user asks for it. */
function AuditSummary() {
  const [open, setOpen] = useState(false);
  const audit = useQuery({
    queryKey: ["library", "audit"],
    queryFn: ({ signal }) => libraryApi.audit(signal),
    enabled: open,
  });
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer text-xs text-primary">文献库自检</summary>
      {audit.error ? <p className="text-xs text-error mt-1">{audit.error.message}</p> : null}
      {audit.isFetching ? <p className="text-xs text-on-surface-variant mt-1">检查中…</p> : null}
      {audit.data ? (
        audit.data.total === 0 ? (
          <p className="text-xs text-on-surface-variant mt-1">没有发现问题。</p>
        ) : (
          <ul className="mt-1 flex flex-col gap-1">
            {audit.data.groups.map((group) => (
              <li key={`${group.rule}-${group.severity}`}>
                <details>
                  <summary className="cursor-pointer text-xs text-on-surface">
                    <span
                      className={`font-mono text-[10px] uppercase tracking-wider ${
                        group.severity === "error" ? "text-error" : "text-on-surface-variant"
                      }`}
                    >
                      {SEVERITY[group.severity] ?? group.severity}
                    </span>{" "}
                    {RULES[group.rule] ?? group.rule} · {group.count} 篇
                  </summary>
                  <ul className="mt-1 ml-3 flex flex-col gap-0.5">
                    {group.papers.map((paper) => (
                      <li key={paper.paperId} className="text-xs">
                        <Link
                          className="text-primary hover:underline"
                          to={`/library/${paper.paperId}`}
                        >
                          {paper.title}
                        </Link>
                      </li>
                    ))}
                    {group.count > group.papers.length ? (
                      <li className="text-[10px] font-mono text-on-surface-variant/70">
                        还有 {group.count - group.papers.length} 篇未列出
                      </li>
                    ) : null}
                  </ul>
                </details>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </details>
  );
}
