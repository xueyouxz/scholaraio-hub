import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { BookOpen, FolderOpen, Search, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { usePageTitle } from "../../app/components/NavigationLayout";
import { libraryApi } from "../../core/library";

export function LibraryPage() {
  const { setTitle } = usePageTitle();
  useEffect(() => {
    setTitle("文献库");
    return () => setTitle("");
  }, [setTitle]);
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const [draft, setDraft] = useState(query);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const client = useQueryClient();
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const parent = useRef<HTMLDivElement>(null);
  const papers = useQuery({
    queryKey: ["library", "search", query],
    queryFn: async ({ signal }) =>
      query
        ? libraryApi.search(query, signal)
        : {
            results: (await libraryApi.papers(signal)).papers.map((paper) => ({
              paper,
              matches: [],
            })),
          },
  });
  const jobs = useQuery({
    queryKey: ["library", "imports"],
    queryFn: ({ signal }) => libraryApi.jobs(signal),
    refetchInterval: (q) =>
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
  const results = papers.data?.results ?? [];
  const virtualizer = useVirtualizer({
    count: results.length,
    getScrollElement: () => parent.current,
    estimateSize: () => 124,
    overscan: 5,
  });
  const acceptFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const pdfs = Array.from(files).filter((file) => file.name.toLowerCase().endsWith(".pdf"));
    if (pdfs.length) upload.mutate(pdfs);
  };
  const error = papers.error ?? upload.error ?? retry.error ?? jobs.error;
  return (
    <div className="flex-1 min-h-0 flex flex-col p-6 gap-5">
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <div>
          <h1 className="text-2xl text-primary">本地文献</h1>
          <p className="text-sm text-on-surface-variant mt-1">查找、阅读，并围绕原文展开对话。</p>
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
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setParams(draft ? { q: draft } : {});
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
          onClick={() =>
            navigate(`/sessions?papers=${[...selected].map(encodeURIComponent).join(",")}`)
          }
        >
          {selected.size ? `询问选中的 ${selected.size} 篇` : "询问文献库"}
        </button>
      </form>
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
                            running: "处理中",
                            completed: "已入库",
                            duplicate: "已存在",
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
            {query ? "没有找到匹配的文献，试试更短的关键词。" : "文献库还是空的，先导入一份 PDF。"}
          </p>
        </div>
      ) : (
        <div ref={parent} className="flex-1 min-h-0 overflow-auto">
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((row) => {
              const result = results[row.index];
              if (!result) return null;
              const { paper, matches } = result;
              const target = `/library/${encodeURIComponent(paper.id)}${matches[0] ? `?line=${matches[0].start_line}&mode=markdown` : ""}`;
              return (
                <article
                  key={paper.id}
                  className="absolute top-0 left-0 w-full rounded-xl border border-outline-variant/15 bg-surface-container-low p-4 flex gap-4"
                  style={{ transform: `translateY(${row.start}px)`, height: 116 }}
                >
                  <input
                    type="checkbox"
                    aria-label={`选择 ${paper.title}`}
                    checked={selected.has(paper.id)}
                    onChange={() =>
                      setSelected((previous) => {
                        const next = new Set(previous);
                        if (next.has(paper.id)) next.delete(paper.id);
                        else next.add(paper.id);
                        return next;
                      })
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <Link
                      to={target}
                      className="font-serif font-semibold text-primary hover:underline line-clamp-1"
                    >
                      {paper.title}
                    </Link>
                    <p className="text-xs text-on-surface-variant truncate mt-1">
                      {[paper.authors, paper.year, paper.journal].filter(Boolean).join(" · ") ||
                        "元数据尚未补齐"}
                    </p>
                    <p className="text-xs mt-2 line-clamp-2">
                      {matches[0]?.text.slice(0, 200) ||
                        paper.abstract ||
                        (paper.parseStatus === "ready" ? "全文已就绪" : paper.error || "等待解析")}
                    </p>
                  </div>
                  <Link className="text-xs text-primary self-center" to={target}>
                    阅读 →
                  </Link>
                </article>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
