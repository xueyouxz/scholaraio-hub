import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Download, FolderOpen, LayoutGrid, List, Search, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { usePageTitle } from "../../app/components/NavigationLayout";
import { libraryApi, newSessionUrl } from "../../core/library";
import { useLibraryEvents } from "../../core/libraryEvents";

import { PaperCollection } from "./components/PaperCollection";
import { ReferenceTools } from "./components/ReferenceTools";

/** Ingest pipeline steps, in the order the import queue runs them. */
const IMPORT_STEPS: Record<string, string> = {
  mineru: "解析 PDF",
  extract: "提取元数据",
  dedup: "查询与查重",
  ingest: "写入文献库",
};

export function LibraryImportPage() {
  const { setTitle } = usePageTitle();
  useEffect(() => {
    setTitle("文献库");
    return () => setTitle("");
  }, [setTitle]);
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const projectId = params.get("project") ?? "";
  const view = params.get("view") === "list" ? "list" : "grid";
  const [newProject, setNewProject] = useState("");
  const [addTarget, setAddTarget] = useState("");
  const projects = useQuery({
    queryKey: ["library", "projects"],
    queryFn: ({ signal }) => libraryApi.projects(signal),
  });
  const project = projects.data?.projects.find((p) => p.id === projectId);
  const updateParams = (patch: Record<string, string>) =>
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      for (const [key, value] of Object.entries(patch)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      return next;
    });
  const [draft, setDraft] = useState(query);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const client = useQueryClient();
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  const papers = useQuery({
    queryKey: ["library", "search", query, projectId],
    queryFn: async ({ signal }) =>
      query
        ? libraryApi.search(query, signal, projectId || undefined)
        : {
            results: (await libraryApi.papers(signal)).papers.map((paper) => ({
              paper,
              matches: [],
            })),
          },
  });
  const streaming = useLibraryEvents();
  const jobs = useQuery({
    queryKey: ["library", "imports"],
    queryFn: ({ signal }) => libraryApi.jobs(signal),
    // The change stream normally reports progress; polling covers it being down.
    refetchInterval: (q) =>
      !streaming &&
      q.state.data?.jobs.some((job) =>
        job.items.some((item) => ["running", "queued"].includes(item.status)),
      )
        ? 1000
        : false,
  });
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["library"] });
  };
  const upload = useMutation({ mutationFn: libraryApi.upload, onSuccess: refresh });
  const [locator, setLocator] = useState("");
  const referenceInput = useRef<HTMLInputElement>(null);
  const references = useMutation({ mutationFn: libraryApi.importReferences, onSuccess: refresh });
  const acquire = useMutation({
    mutationFn: libraryApi.fetchPaper,
    onSuccess: () => {
      refresh();
      setLocator("");
    },
  });
  const retry = useMutation({ mutationFn: libraryApi.retry, onSuccess: refresh });
  const pending =
    jobs.data?.jobs.some((job) =>
      job.items.some((item) => ["running", "queued"].includes(item.status)),
    ) ?? false;
  useEffect(() => {
    if (!pending) void client.invalidateQueries({ queryKey: ["library", "search"] });
  }, [pending, client]);
  useEffect(() => {
    folderInput.current?.setAttribute("webkitdirectory", "");
  }, []);
  const members = new Set(project?.paperIds);
  const results = (papers.data?.results ?? []).filter(
    ({ paper }) => !projectId || members.has(paper.id),
  );
  const createProject = useMutation({
    mutationFn: libraryApi.createProject,
    onSuccess: (data) => {
      refresh();
      setNewProject("");
      updateParams({ project: data.id, newProject: "", manage: "1" });
    },
  });
  const membership = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "add" | "remove" }) =>
      libraryApi.projectPapers(id, [...selected], action),
    onSuccess: () => {
      refresh();
      setSelected(new Set());
    },
  });
  const acceptFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const pdfs = Array.from(files).filter((file) => file.name.toLowerCase().endsWith(".pdf"));
    if (pdfs.length) upload.mutate(pdfs);
  };
  const error =
    papers.error ??
    projects.error ??
    createProject.error ??
    membership.error ??
    upload.error ??
    retry.error ??
    jobs.error;
  return (
    <div className="flex-1 min-h-0 flex flex-col p-4 md:p-6 gap-4">
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <div>
          <h1 className="text-2xl text-primary">{project?.name ?? "本地文献"}</h1>
          <p className="text-sm text-on-surface-variant mt-1">
            查找、阅读，并围绕原文展开对话。
            {papers.data
              ? ` · ${results.length} 篇${query && results.length === 200 ? "（显示前 200 条匹配）" : ""}`
              : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <input
            ref={fileInput}
            type="file"
            multiple
            accept="application/pdf"
            className="sr-only"
            aria-label="选择 PDF 文件"
            onChange={(event) => {
              acceptFiles(event.target.files);
              event.target.value = "";
            }}
          />
          <input
            ref={folderInput}
            type="file"
            multiple
            className="sr-only"
            aria-label="选择文献目录"
            onChange={(event) => {
              acceptFiles(event.target.files);
              event.target.value = "";
            }}
          />
          <button
            type="button"
            className="hub-button"
            disabled={upload.isPending}
            onClick={() => folderInput.current?.click()}
          >
            <FolderOpen size={16} />
            导入目录
          </button>
          <button
            type="button"
            className="hub-button signature-gradient text-white"
            disabled={upload.isPending}
            onClick={() => fileInput.current?.click()}
          >
            <Upload size={16} />
            {upload.isPending ? "上传中…" : "导入 PDF"}
          </button>
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm flex-1 min-w-40">
          文献项目
          <select
            aria-label="查看文献项目"
            className="hub-input w-full block mt-1"
            value={projectId}
            onChange={(e) => updateParams({ project: e.target.value, view })}
          >
            <option value="">全部文献</option>
            {projects.data?.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}（{p.paperCount}）
              </option>
            ))}
          </select>
        </label>
        <fieldset className="flex gap-1" aria-label="文献视图">
          <button
            type="button"
            className="hub-button"
            aria-label="卡片视图"
            aria-pressed={view === "grid"}
            onClick={() => updateParams({ view: "grid" })}
          >
            <LayoutGrid size={18} />
          </button>
          <button
            type="button"
            className="hub-button"
            aria-label="列表视图"
            aria-pressed={view === "list"}
            onClick={() => updateParams({ view: "list" })}
          >
            <List size={18} />
          </button>
        </fieldset>
      </div>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (locator.trim()) acquire.mutate(locator.trim());
        }}
      >
        <label className="sr-only" htmlFor="library-locator">
          按标识获取文献
        </label>
        <input
          id="library-locator"
          name="locator"
          className="hub-input flex-1 min-w-48"
          value={locator}
          onChange={(event) => setLocator(event.target.value)}
          placeholder="DOI、arXiv 编号、专利号或论文链接…"
        />
        <button className="hub-button" type="submit" disabled={acquire.isPending}>
          <Download size={16} />
          {acquire.isPending ? "获取中…" : "获取并入库"}
        </button>
        <input
          ref={referenceInput}
          type="file"
          accept=".bib,.ris,.enw,.txt"
          className="sr-only"
          aria-label="选择 BibTeX 或 RIS 文件"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) references.mutate(file);
            event.target.value = "";
          }}
        />
        <button
          className="hub-button"
          type="button"
          disabled={references.isPending}
          onClick={() => referenceInput.current?.click()}
        >
          {references.isPending ? "导入中…" : "从 Zotero/EndNote 导出文件导入"}
        </button>
      </form>
      {references.data?.skipped.length ? (
        <p className="text-sm text-on-surface-variant">
          {references.data.skipped.length} 条未能获取 PDF：
          {references.data.skipped
            .slice(0, 3)
            .map((entry) => entry.title)
            .join("、")}
          {references.data.skipped.length > 3 ? " 等" : ""}
        </p>
      ) : null}
      {references.error ? (
        <p role="alert" className="text-error text-sm">
          {references.error.message}
        </p>
      ) : null}
      {acquire.error ? (
        <p role="alert" className="text-error text-sm">
          {acquire.error.message}
        </p>
      ) : null}
      <ReferenceTools paperIds={[...selected]} projectId={projectId || undefined} />
      <details open={params.has("newProject") || undefined} className="text-sm">
        <summary className="cursor-pointer text-primary">新建文献项目</summary>
        <form
          className="flex gap-2 mt-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (newProject.trim()) createProject.mutate(newProject.trim());
          }}
        >
          <input
            aria-label="项目名称"
            name="projectName"
            className="hub-input flex-1"
            maxLength={120}
            required
            value={newProject}
            onChange={(e) => setNewProject(e.target.value)}
            placeholder="例如：光谱研究…"
          />
          <button type="submit" className="hub-button" disabled={createProject.isPending}>
            创建项目
          </button>
        </form>
      </details>
      {projectId && projects.data && !project ? (
        <p role="alert" className="text-error">
          项目不存在，请重新选择。
        </p>
      ) : null}
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          updateParams({ q: draft });
        }}
      >
        <label className="sr-only" htmlFor="library-query">
          检索文献
        </label>
        <input
          id="library-query"
          name="query"
          className="hub-input flex-1"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="搜索标题、作者、DOI 或全文关键词…"
        />
        <button className="hub-button" type="submit">
          <Search size={16} />
          检索
        </button>
        <button
          className="hub-button"
          type="button"
          onClick={() => navigate(newSessionUrl(projectId || undefined, [...selected]))}
        >
          {selected.size ? `询问选中的 ${selected.size} 篇` : projectId ? "询问项目" : "询问文献库"}
        </button>
      </form>
      {selected.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>已选 {selected.size} / 100 篇</span>
          <select
            aria-label="添加到项目"
            className="hub-input"
            value={addTarget}
            onChange={(e) => setAddTarget(e.target.value)}
          >
            <option value="">选择目标项目…</option>
            {projects.data?.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="hub-button"
            disabled={!addTarget || membership.isPending}
            onClick={() => membership.mutate({ id: addTarget, action: "add" })}
          >
            添加到项目
          </button>
          {project ? (
            <button
              type="button"
              className="hub-button"
              disabled={membership.isPending}
              onClick={() => membership.mutate({ id: project.id, action: "remove" })}
            >
              从项目移除
            </button>
          ) : null}
          <button type="button" className="hub-button" onClick={() => setSelected(new Set())}>
            清除选择
          </button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-error">
          {error.message}
        </p>
      ) : null}
      {jobs.data?.jobs.length ? (
        <details className="rounded-xl bg-surface-container-low p-3" open={pending || undefined}>
          <summary className="cursor-pointer text-sm">
            导入记录{pending ? " · 正在处理…" : ""}
          </summary>
          <div aria-live="polite" className="max-h-40 overflow-auto mt-2 text-xs space-y-2">
            {jobs.data.jobs
              .slice()
              .reverse()
              .map((job) => (
                <div key={job.id}>
                  {job.items.map((item) => (
                    <div key={item.id} className="flex gap-3 py-1">
                      <span className="truncate flex-1">{item.name}</span>
                      <span>
                        {
                          {
                            queued: "排队中",
                            running: item.step
                              ? `处理中 · ${IMPORT_STEPS[item.step] ?? item.step}`
                              : "处理中",
                            completed: "已入库",
                            completed_incomplete: `已入库 · 元数据不完整${
                              item.missingMetadata?.length
                                ? `（缺 ${item.missingMetadata.join("、")}）`
                                : ""
                            }`,
                            duplicate: "已存在",
                            needs_review: "待人工确认",
                            failed: "失败",
                          }[item.status]
                        }
                      </span>
                      {item.error ? (
                        <span className="text-error break-words">{item.error}</span>
                      ) : null}
                    </div>
                  ))}
                  {job.items.some((item) => item.status === "failed") ? (
                    <button
                      className="hub-button"
                      type="button"
                      disabled={
                        retry.isPending ||
                        job.items.some((item) => ["queued", "running"].includes(item.status))
                      }
                      onClick={() => retry.mutate(job.id)}
                    >
                      重试失败项
                    </button>
                  ) : null}
                </div>
              ))}
          </div>
        </details>
      ) : null}
      {papers.isLoading ? (
        <output>正在加载文献…</output>
      ) : results.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-on-surface-variant gap-4">
          <BookOpen size={36} />
          <p>
            {query
              ? "没有找到匹配的文献，试试更短的关键词。"
              : "当前范围没有文献，可从全部文献添加到项目，或先导入 PDF。"}
          </p>
        </div>
      ) : (
        <PaperCollection
          results={results}
          view={view}
          selected={selected}
          projectId={projectId || undefined}
          onToggle={(id) =>
            setSelected((previous) => {
              const next = new Set(previous);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            })
          }
        />
      )}
    </div>
  );
}
