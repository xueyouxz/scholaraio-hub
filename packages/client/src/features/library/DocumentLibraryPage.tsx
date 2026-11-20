import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { libraryUrl } from "../../core/http";
import { libraryApi, readerUrl } from "../../core/library";
import { useLibraryStream } from "../../core/libraryEvents";
import { usePageTitle } from "../../shared/layout";

const fieldClass = "rounded-lg border border-outline-variant/40 bg-surface px-3 py-2 text-sm";

/** Shared documents, portable downloads and the local Codex connection. */
export function DocumentLibraryPage() {
  const { setTitle } = usePageTitle();
  useEffect(() => setTitle("文献管理"), [setTitle]);
  useLibraryStream();
  const cache = useQueryClient();
  const papers = useQuery({
    queryKey: ["library", "papers"],
    queryFn: ({ signal }) => libraryApi.papers(signal),
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [venue, setVenue] = useState("");
  const [category, setCategory] = useState("");
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const rows = papers.data?.papers ?? [];
  const categories = useMemo(() => [...new Set(rows.map((row) => row.category))].sort(), [rows]);
  const visible = useMemo(
    () =>
      rows.filter(
        (row) =>
          (!venue || row.category === venue) &&
          `${row.title} ${row.authors} ${row.journal}`
            .toLocaleLowerCase()
            .includes(filter.toLocaleLowerCase()),
      ),
    [rows, venue, filter],
  );
  const ids = rows.filter((row) => selected.has(row.id)).map((row) => row.id);
  const allVisible = visible.length > 0 && visible.every((row) => selected.has(row.id));
  const refresh = async () => {
    await cache.invalidateQueries({ queryKey: ["library"] });
  };
  const classify = useMutation({
    mutationFn: (value: string | null) => libraryApi.categorize(ids, value),
    onSuccess: async (result) => {
      setNotice(`已更新 ${result.updated} 篇文献的类别`);
      await refresh();
    },
  });
  const importing = useMutation({
    mutationFn: libraryApi.importBundle,
    onSuccess: async (result) => {
      setNotice(
        `已导入 ${result.imported} 篇，跳过 ${result.skipped} 篇重复文献，导入 ${result.vectors} 条向量`,
      );
      await refresh();
    },
  });
  const download = useMutation({
    mutationFn: async (format: "bundle" | "pdf" | "markdown") => {
      const blob = await libraryApi.downloadBundle(ids, format);
      const url = URL.createObjectURL(blob);
      try {
        const link = document.createElement("a");
        link.href = url;
        link.download = `scholaraio-${format}.zip`;
        link.click();
      } finally {
        URL.revokeObjectURL(url);
      }
    },
    onSuccess: () => setNotice("下载已开始，请查看浏览器下载列表"),
  });
  const mcpUrl = libraryUrl("/mcp/");
  const config = `[mcp_servers.scholaraio]\nurl = "${mcpUrl}"`;
  const error =
    actionError || classify.error?.message || importing.error?.message || download.error?.message;
  const busy = classify.isPending || importing.isPending || download.isPending;
  return (
    <div className="flex-1 overflow-auto p-6 space-y-5">
      <section
        className="rounded-xl border border-outline-variant/20 bg-surface-container-low p-5 space-y-3"
        aria-labelledby="mcp-heading"
      >
        <h1 id="mcp-heading" className="text-xl">
          在本地 Codex 中读取文献库
        </h1>
        <p className="text-sm text-on-surface-variant">
          无需网页登录。MCP 提供论文列表、全文搜索、指定 PDF 检索和带行号的正文；回答由你本地的
          Codex 生成。
        </p>
        <label className="block text-sm" htmlFor="mcp-config">
          在 Codex 的 MCP 配置中加入：
        </label>
        <textarea
          id="mcp-config"
          name="mcp-config"
          readOnly
          value={config}
          rows={2}
          spellCheck={false}
          className={`${fieldClass} w-full font-mono`}
        />
        <button
          className="btn-pill px-3 py-2 text-sm"
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(config);
              setNotice("已复制 MCP 配置");
              setActionError("");
            } catch {
              setActionError("无法访问剪贴板，请选中上方配置手动复制");
            }
          }}
        >
          复制配置
        </button>
        <p className="text-xs text-on-surface-variant">
          示例提问：先列出文献库的
          PDF，再仅使用我指定的论文检索并标注引用。关键词检索可直接使用；语义检索需要先在“分析”页准备向量索引。
        </p>
      </section>
      <section className="space-y-3" aria-labelledby="documents-heading">
        <h2 id="documents-heading" className="text-lg">
          共享文献
        </h2>
        <p className="text-sm text-on-surface-variant">
          识别到会议时自动归类；不确定的论文标为“待分类”，可手动分配。文献包包含解析正文、图片、原
          PDF（如有）和已生成的兼容向量。
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm flex items-center gap-2">
            筛选
            <input
              name="document-filter"
              autoComplete="off"
              type="search"
              className={fieldClass}
              placeholder="标题、作者、会议…"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
          </label>
          <label className="text-sm flex items-center gap-2">
            类别
            <select
              name="category-filter"
              className={fieldClass}
              value={venue}
              onChange={(event) => setVenue(event.target.value)}
            >
              <option value="">全部类别</option>
              {categories.map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>
          </label>
          <label
            className={`btn-pill px-3 py-2 text-sm cursor-pointer focus-within:ring-2 focus-within:ring-primary ${busy ? "opacity-50" : ""}`}
          >
            {importing.isPending ? "正在导入…" : "上传已解析文献包"}
            <input
              name="document-bundle"
              aria-label="上传已解析文献包"
              type="file"
              accept=".zip,application/zip"
              disabled={busy}
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) importing.mutate(file);
                event.target.value = "";
              }}
            />
          </label>
        </div>
        <p className="text-xs text-on-surface-variant">
          可直接上传 papers 文件夹压缩的 ZIP，每篇目录需有 meta.json 和 paper.md，无需生成清单。
          支持整库一次上传，无需分包；导入前会检查磁盘空间。大文件上传和入库期间请保持页面打开。
          也支持导出的文献包和 MinerU ZIP。 向量随文献包上传，嵌入模型须与本库一致。
        </p>
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-surface-container-low p-3">
          <span className="text-sm tabular-nums">已选择 {ids.length} 篇</span>
          <button
            type="button"
            className="btn-pill px-3 py-2 text-sm"
            disabled={!ids.length || ids.length > 500 || busy}
            onClick={() => download.mutate("pdf")}
          >
            下载 PDF
          </button>
          <button
            type="button"
            className="btn-pill px-3 py-2 text-sm"
            disabled={!ids.length || ids.length > 500 || busy}
            onClick={() => download.mutate("markdown")}
          >
            下载解析结果
          </button>
          <button
            type="button"
            className="btn-pill px-3 py-2 text-sm"
            disabled={!ids.length || ids.length > 500 || busy}
            onClick={() => download.mutate("bundle")}
          >
            下载文献包（含向量）
          </button>
          <label className="sr-only" htmlFor="manual-category">
            手动类别
          </label>
          <input
            id="manual-category"
            name="manual-category"
            autoComplete="off"
            className={fieldClass}
            maxLength={120}
            placeholder="输入类别…"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          />
          <button
            type="button"
            className="btn-pill px-3 py-2 text-sm"
            disabled={!ids.length || ids.length > 500 || !category.trim() || busy}
            onClick={() => classify.mutate(category)}
          >
            分配类别
          </button>
          <button
            type="button"
            className="btn-pill px-3 py-2 text-sm"
            disabled={!ids.length || ids.length > 500 || busy}
            onClick={() => classify.mutate(null)}
          >
            恢复自动分类
          </button>
        </div>
        <p className="text-xs text-on-surface-variant">每次最多选择 500 篇文献操作。</p>
        <div aria-live="polite">{notice && <p className="text-sm text-primary">{notice}</p>}</div>
        {error && (
          <p role="alert" className="text-sm text-error">
            {error}
          </p>
        )}
        {papers.error && (
          <p role="alert" className="text-error">
            加载失败：{papers.error.message}
          </p>
        )}
        {papers.isPending ? (
          <output>加载文献中…</output>
        ) : visible.length === 0 ? (
          <p className="p-6 text-on-surface-variant">
            {rows.length
              ? "没有符合筛选条件的文献。"
              : "文献库还是空的。点击“导入文献”上传 PDF，或上传已解析的文献包。"}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-outline-variant/20">
            <table className="w-full text-sm text-left">
              <thead className="bg-surface-container-low">
                <tr>
                  <th className="p-3">
                    <input
                      type="checkbox"
                      aria-label="选择当前筛选的全部文献"
                      checked={allVisible}
                      onChange={() =>
                        setSelected((old) => {
                          const next = new Set(old);
                          for (const row of visible) {
                            if (allVisible) next.delete(row.id);
                            else next.add(row.id);
                          }
                          return next;
                        })
                      }
                    />
                  </th>
                  <th className="p-3">论文</th>
                  <th className="p-3">类别</th>
                  <th className="p-3">解析状态</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr key={row.id} className="border-t border-outline-variant/15">
                    <td className="p-3">
                      <input
                        type="checkbox"
                        aria-label={`选择 ${row.title}`}
                        checked={selected.has(row.id)}
                        onChange={() =>
                          setSelected((old) => {
                            const next = new Set(old);
                            if (next.has(row.id)) next.delete(row.id);
                            else next.add(row.id);
                            return next;
                          })
                        }
                      />
                    </td>
                    <td className="p-3 max-w-lg">
                      <Link
                        className="text-primary break-words hover:underline"
                        to={readerUrl(row.id)}
                      >
                        {row.title}
                      </Link>
                      <p className="text-xs text-on-surface-variant mt-1 break-words">
                        {row.journal || "会议 / 期刊未识别"} {row.year}
                      </p>
                    </td>
                    <td className="p-3">
                      <span className="break-words">{row.category}</span>
                      <p className="text-xs text-on-surface-variant">
                        {row.categorySource === "manual"
                          ? "手动"
                          : row.categorySource === "conference"
                            ? "根据会议"
                            : "待分配"}
                      </p>
                    </td>
                    <td className="p-3">
                      {row.hasMarkdown
                        ? "已解析"
                        : row.parseStatus === "failed"
                          ? "解析失败"
                          : "等待解析"}
                      {!row.hasPdf && <p className="text-xs text-on-surface-variant">未附原 PDF</p>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
