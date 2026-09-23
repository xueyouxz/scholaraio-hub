import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { libraryApi, newSessionUrl } from "../../../core/library";
import { ChipGroup } from "../../../shared/ui/ChipGroup";
import { Dialog } from "../../../shared/ui/Dialog";
import { ImportStaging, type Staged } from "./import/sources";
import { submitStaged } from "./import/submit";

/**
 * Why a name is refused, said before the server has to refuse it.
 *
 * A workspace is a directory, and its name is the directory's name, so these
 * are the same rules the library applies when it creates one.
 */
export function nameProblem(name: string): string | null {
  if (!name) return "请输入 Workspace 名称";
  if (name !== name.trim()) return "名称首尾不能有空格";
  if (name.length > 120) return "名称不能超过 120 个字符";
  if (name === "." || name === "..") return "名称不能是 . 或 ..";
  if (name.startsWith(".")) return "名称不能以 . 开头";
  if (/[/\\:]/.test(name)) return "名称不能包含 / \\ : ";
  if (name.includes("..")) return "名称不能包含 ..";
  for (const character of name) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 32) return "名称不能包含控制字符";
  }
  return null;
}

const SOURCES = [
  { value: "internal", label: "内部文献" },
  { value: "external", label: "外部文献" },
];

/**
 * Creating a workspace, with the literature that belongs in it.
 *
 * The name is what the directory will be called, so it is checked here by the
 * same rules the library uses. Papers already in the library join the new
 * workspace immediately; papers still being imported cannot, because the queue
 * has not given them ids yet — they land in the library and the dialog says so.
 */
export function WorkspaceCreateDialog({ onClose }: { onClose: () => void }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [touched, setTouched] = useState(false);
  const [source, setSource] = useState("internal");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [staged, setStaged] = useState<Staged[]>([]);

  const papers = useQuery({
    queryKey: ["library", "papers"],
    queryFn: ({ signal }) => libraryApi.papers(signal),
    select: (data) => data.papers.map((paper) => ({ id: paper.id, title: paper.title })),
  });

  const create = useMutation({
    mutationFn: async () => {
      const project = await libraryApi.createProject(name.trim());
      if (picked.size) await libraryApi.projectPapers(project.id, [...picked], "add");
      if (staged.length) await submitStaged(staged);
      return project;
    },
    onSuccess: (project) => {
      void client.invalidateQueries({ queryKey: ["library"] });
      void client.invalidateQueries({ queryKey: ["sessions"] });
      onClose();
      navigate(newSessionUrl(project.id));
    },
  });

  const problem = nameProblem(name);
  const toggle = (id: string) =>
    setPicked((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Dialog
      wide
      title="新建 Workspace"
      description="一个 Workspace 是一组文献加上围绕它们的会话。"
      onClose={onClose}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          setTouched(true);
          if (!problem) create.mutate();
        }}
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-on-surface-variant">
            名称
          </span>
          <input
            name="workspace-name"
            aria-label="Workspace 名称"
            value={name}
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => setTouched(true)}
            placeholder="例如 湍流减阻综述"
            className="rounded-md border border-outline-variant/20 bg-surface-container px-3 py-2 text-sm text-on-surface outline-none focus:ring-2 focus:ring-primary/20"
          />
          {touched && problem ? (
            <span role="alert" className="text-xs text-error">
              {problem}
            </span>
          ) : null}
        </label>

        <ChipGroup label="加入文献" value={source} options={SOURCES} onChange={setSource} />

        {source === "internal" ? (
          <InternalPicker
            papers={papers.data ?? []}
            loading={papers.isLoading}
            picked={picked}
            onToggle={toggle}
          />
        ) : (
          <>
            <ImportStaging
              staged={staged}
              onAdd={(entry) => setStaged((previous) => [...previous, entry])}
              onDrop={(id) => setStaged((previous) => previous.filter((item) => item.id !== id))}
            />
            {staged.length ? (
              <p className="text-xs text-on-surface-variant">
                导入在后台排队：入库后在文献库中多选，即可加入本 Workspace。
              </p>
            ) : null}
          </>
        )}

        {create.error ? (
          <p role="alert" className="text-xs text-error break-words">
            {create.error.message}
          </p>
        ) : null}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={create.isPending || Boolean(problem)}
            className="signature-gradient rounded-full px-4 py-2 text-sm font-semibold text-on-primary active:scale-95 disabled:opacity-40 border-0 cursor-pointer"
          >
            {create.isPending ? "创建中…" : "创建并开始会话"}
          </button>
          {picked.size ? (
            <span className="text-xs text-on-surface-variant">已选 {picked.size} 篇</span>
          ) : null}
        </div>
      </form>
    </Dialog>
  );
}

/** The papers already in the library, filtered by whatever the user types. */
function InternalPicker({
  papers,
  loading,
  picked,
  onToggle,
}: {
  papers: { id: string; title: string }[];
  loading: boolean;
  picked: Set<string>;
  onToggle: (id: string) => void;
}) {
  const [filter, setFilter] = useState("");
  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const matched = needle
      ? papers.filter((paper) => paper.title.toLowerCase().includes(needle))
      : papers;
    return matched.slice(0, 200);
  }, [papers, filter]);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 rounded-md border border-outline-variant/20 bg-surface-container px-3 py-1.5">
        <Search className="w-3.5 h-3.5 shrink-0 text-on-surface-variant" aria-hidden="true" />
        <input
          aria-label="筛选文献"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="按标题筛选…"
          className="min-w-0 flex-1 bg-transparent text-sm text-on-surface outline-none placeholder:text-on-surface-variant/40"
        />
      </div>
      {loading ? <p className="text-xs text-on-surface-variant">加载中…</p> : null}
      {!loading && papers.length === 0 ? (
        <p className="text-xs text-on-surface-variant">
          文献库还是空的，可以先切到「外部文献」导入。
        </p>
      ) : null}
      <ul className="flex max-h-56 flex-col overflow-auto divide-y divide-outline-variant/10">
        {shown.map((paper) => {
          const checked = picked.has(paper.id);
          return (
            <li key={paper.id}>
              <button
                type="button"
                aria-pressed={checked}
                onClick={() => onToggle(paper.id)}
                className={`flex w-full items-center gap-2 px-2 py-1.5 text-left transition-colors border-0 cursor-pointer bg-transparent ${
                  checked ? "text-primary" : "text-on-surface hover:bg-surface-container/60"
                }`}
              >
                <Check
                  className={`w-3.5 h-3.5 shrink-0 ${checked ? "opacity-100" : "opacity-0"}`}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 truncate text-xs">{paper.title}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
