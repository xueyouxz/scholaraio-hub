import type { ProviderName } from "@scholaraio-hub/shared";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { UNASSIGNED, projectSessionsQuery, projectsQuery } from "../../core/projects";
import { newSessionUrl } from "../../core/sessions";
import { usePageTitle } from "../../shared/layout";
import { ChipGroup } from "../../shared/ui/ChipGroup";
import { ProviderLogo } from "../../shared/ui/ProviderLogo";
import { SessionRow } from "../components/SessionRow";

const PAGE = 30;
const FILTERS: Array<{ provider?: ProviderName; label: string }> = [
  { label: "全部" },
  { provider: "claude", label: "Claude Code" },
  { provider: "codex", label: "Codex" },
];

/** One project's sessions (or those in no project), newest first, one agent's or all. */
export function ProjectPage() {
  const { projectId = "" } = useParams();
  const { setTitle } = usePageTitle();
  const projects = useQuery(projectsQuery);
  const unassigned = projectId === UNASSIGNED;
  const project = projects.data?.projects.find((item) => item.id === projectId);
  const [provider, setProvider] = useState<ProviderName>();
  const [limit, setLimit] = useState(PAGE);
  const sessions = useQuery(projectSessionsQuery(projectId, limit, provider));
  const name = unassigned ? "未归属会话" : (project?.name ?? "项目");
  useEffect(() => {
    setTitle(name);
    return () => setTitle("");
  }, [setTitle, name]);
  const list = sessions.data?.sessions ?? [];
  return (
    <div className="w-full max-w-3xl mx-auto px-6 pt-4 pb-10">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <p
          className="flex-1 min-w-0 truncate text-[12px] font-mono text-on-surface-variant"
          title={project?.path}
        >
          {unassigned ? "没有在任何项目目录里运行的会话" : project?.path}
        </p>
        {unassigned ? null : (
          <Link
            to={newSessionUrl({ project: projectId })}
            className="inline-flex items-center gap-1.5 rounded-full signature-gradient px-3.5 py-1.5 text-sm font-semibold text-on-primary"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            新会话
          </Link>
        )}
      </div>
      <div className="mb-3">
        <ChipGroup<ProviderName | "">
          label="按工具筛选"
          value={provider ?? ""}
          onChange={(value) => {
            setProvider(value || undefined);
            setLimit(PAGE);
          }}
          chips={FILTERS.map((filter) => ({
            value: filter.provider ?? "",
            label: filter.label,
            icon: filter.provider ? (
              <ProviderLogo provider={filter.provider} size={12} />
            ) : undefined,
          }))}
        />
      </div>
      {sessions.error ? (
        <p role="alert" className="text-sm text-error">
          {sessions.error.message}
        </p>
      ) : null}
      {sessions.isLoading ? (
        <p className="py-8 text-center text-sm text-on-surface-variant/60">加载中…</p>
      ) : null}
      {sessions.data && list.length === 0 ? (
        <p className="py-10 text-center text-sm text-on-surface-variant/60">还没有会话</p>
      ) : null}
      <div className="space-y-0.5">
        {list.map((session) => (
          <SessionRow key={session.id} session={session} />
        ))}
      </div>
      {sessions.data?.nextOffset !== null && sessions.data?.nextOffset !== undefined ? (
        <button
          type="button"
          onClick={() => setLimit((current) => current + PAGE)}
          className="mt-3 rounded-full bg-surface-container-high px-4 py-1.5 text-sm text-on-surface hover:bg-surface-container"
        >
          显示更多
        </button>
      ) : null}
    </div>
  );
}
