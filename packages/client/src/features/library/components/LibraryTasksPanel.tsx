import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { libraryApi } from "../../../core/library";
import { CAPABILITIES } from "../tasks";
import { CapabilityPrompt } from "./CapabilityPrompt";

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
        <ul className="mt-1 flex flex-col gap-0.5">
          {audit.data.total === 0 ? (
            <li className="text-xs text-on-surface-variant">没有发现问题。</li>
          ) : (
            audit.data.groups.map((group) => (
              <li key={`${group.rule}-${group.severity}`} className="text-[10px] font-mono">
                <span
                  className={group.severity === "error" ? "text-error" : "text-on-surface-variant"}
                >
                  {group.severity}
                </span>{" "}
                {group.rule} · {group.count} 篇
              </li>
            ))
          )}
        </ul>
      ) : null}
    </details>
  );
}
