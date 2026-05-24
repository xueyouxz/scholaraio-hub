import type { ScholaraioSkill, ScholaraioSkillCategory } from "@scholaraio-hub/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, RefreshCw, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { usePageTitle } from "../../app/components/NavigationLayout";
import { api } from "../../core/api";
import { queryKeys } from "../../core/queryKeys";
import { SkillDetailView } from "./SkillDetailView";

interface GroupedCategory {
  category: ScholaraioSkillCategory;
  skills: ScholaraioSkill[];
}

function groupSkills(
  skills: ScholaraioSkill[],
  categories: ScholaraioSkillCategory[],
): GroupedCategory[] {
  const byId = new Map<string, ScholaraioSkill[]>();
  for (const skill of skills) {
    const list = byId.get(skill.category) ?? [];
    list.push(skill);
    byId.set(skill.category, list);
  }
  return categories
    .map((category) => ({ category, skills: byId.get(category.id) ?? [] }))
    .filter((group) => group.skills.length > 0)
    .sort((a, b) => a.category.order - b.category.order);
}

export function SkillsPage() {
  const { setTitle } = usePageTitle();
  setTitle("Skills");

  const { skillId } = useParams<{ skillId?: string }>();
  const queryClient = useQueryClient();
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(["__uncategorized__"]));

  const listQuery = useQuery({
    queryKey: queryKeys.scholaraioSkills(),
    queryFn: ({ signal }) => api.listScholaraioSkills({ signal }),
    staleTime: Number.POSITIVE_INFINITY,
  });

  const refreshMutation = useMutation({
    mutationFn: () => api.refreshScholaraioSkills(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.scholaraioSkills() });
      queryClient.invalidateQueries({ queryKey: ["scholaraio-skills"] });
    },
  });

  const groups = useMemo(() => {
    if (!listQuery.data) return [];
    return groupSkills(listQuery.data.skills, listQuery.data.categories);
  }, [listQuery.data]);

  const toggleCategory = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden">
      <aside className="w-80 shrink-0 border-r border-outline-variant flex flex-col bg-surface">
        <div className="flex items-center justify-between px-4 py-3 border-b border-outline-variant">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            <h2 className="font-sans text-sm font-semibold text-on-surface">科研 Skills</h2>
            {listQuery.data ? (
              <span className="text-xs font-mono text-on-surface-variant">
                {listQuery.data.skills.length}
              </span>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => refreshMutation.mutate()}
            disabled={refreshMutation.isPending}
            title="重新扫描 scholaraio skills 目录"
            className="p-1.5 rounded-lg hover:bg-surface-container text-on-surface-variant disabled:opacity-40"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${refreshMutation.isPending ? "animate-spin" : ""}`}
            />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {listQuery.isLoading ? (
            <div className="px-3 py-8 text-center text-xs text-on-surface-variant">加载中…</div>
          ) : listQuery.isError ? (
            <div className="px-3 py-8 text-center text-xs text-error">
              加载失败。请确认 ~/scholaraio/skills 存在，或设置 SCHOLARAIO_SKILLS_DIR。
            </div>
          ) : groups.length === 0 ? (
            <div className="px-3 py-8 text-center text-xs text-on-surface-variant">
              未发现任何 skill。
            </div>
          ) : (
            groups.map(({ category, skills }) => {
              const isCollapsed = collapsed.has(category.id);
              const isUncategorized = category.id === "__uncategorized__";
              return (
                <div key={category.id} className="mb-2">
                  <button
                    type="button"
                    onClick={() => toggleCategory(category.id)}
                    className="w-full flex items-center justify-between px-2 py-1.5 rounded hover:bg-surface-container text-on-surface-variant"
                    title={
                      isUncategorized
                        ? "这些 skill 是 scholaraio 仓库新增的，尚未在前端归类。运行 pnpm skills:sync 后提 PR。"
                        : undefined
                    }
                  >
                    <span className="font-sans text-xs font-semibold uppercase tracking-wider">
                      {category.label}（{skills.length}）
                    </span>
                    <span className="text-xs font-mono">{isCollapsed ? "+" : "−"}</span>
                  </button>
                  {!isCollapsed ? (
                    <ul className="mt-1 space-y-0.5">
                      {skills.map((skill) => (
                        <li key={skill.name}>
                          <SkillListItem skill={skill} active={skill.name === skillId} />
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </aside>
      <main className="flex-1 min-w-0 overflow-y-auto bg-background">
        {skillId ? (
          <SkillDetailView skillName={skillId} />
        ) : (
          <div className="h-full flex items-center justify-center text-center px-8">
            <div className="max-w-md text-sm text-on-surface-variant">
              <Sparkles className="w-8 h-8 mx-auto mb-3 text-on-surface-variant/60" />
              <p>从左侧选择一个 skill 查看完整说明。</p>
              <p className="mt-2 text-xs">
                在会话中输入 <code className="px-1 py-0.5 rounded bg-surface-container">/</code>{" "}
                也可以激活这些 skill。
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function SkillListItem({ skill, active }: { skill: ScholaraioSkill; active: boolean }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex items-stretch group">
      <Link
        to={`/skills/${encodeURIComponent(skill.name)}`}
        className={`flex-1 min-w-0 px-2 py-1.5 rounded-l text-left transition-colors ${
          active ? "bg-primary/10 text-primary" : "text-on-surface hover:bg-surface-container"
        }`}
      >
        <div className="font-mono text-xs truncate">{skill.name}</div>
        <div className="font-sans text-[11px] text-on-surface-variant truncate mt-0.5">
          {skill.description}
        </div>
      </Link>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void navigator.clipboard.writeText(`/${skill.name}`).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
          });
        }}
        title={`复制 /${skill.name}`}
        className="px-2 rounded-r text-on-surface-variant opacity-0 group-hover:opacity-100 hover:bg-surface-container transition-opacity"
      >
        {copied ? <Check className="w-3.5 h-3.5 text-primary" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}
