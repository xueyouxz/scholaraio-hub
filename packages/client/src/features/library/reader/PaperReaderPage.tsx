import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { usePageTitle } from "../../../app/components/NavigationLayout";
import { scholar } from "../../../core/api";
import {
  buildPdfUrl,
  canNavigateToReader,
  canReadPdf,
  findPaperById,
  toPaperRef,
} from "../paperUtils";
import type { PaperDetail, PaperReference, ReadingTab } from "../types";
import { LayerReader } from "./LayerReader";
import { PdfViewer } from "./PdfViewer";
import { ReaderSidebar } from "./ReaderSidebar";

// ─── Tab definitions ──────────────────────────────────────────────────────────

interface Tab {
  id: ReadingTab;
  label: string;
  /** 仅在 layer 层级下显示的短标签（chip 内）。 */
  shortLabel: string;
}

const TABS: Tab[] = [
  { id: "l1", label: "L1 元数据", shortLabel: "L1" },
  { id: "l2", label: "L2 摘要", shortLabel: "L2" },
  { id: "l3", label: "L3 结论", shortLabel: "L3" },
  { id: "l4", label: "L4 全文", shortLabel: "L4" },
  { id: "pdf", label: "PDF", shortLabel: "PDF" },
];

// ─── Component ────────────────────────────────────────────────────────────────

export function PaperReaderPage() {
  const { paperId } = useParams<{ paperId: string }>();
  const navigate = useNavigate();
  const { setTitle } = usePageTitle();

  const [papers, setPapers] = useState<PaperReference[]>([]);
  const [loadingPapers, setLoadingPapers] = useState(true);
  const [papersError, setPapersError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<ReadingTab>("l2");

  const [detail, setDetail] = useState<PaperDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailFetched, setDetailFetched] = useState(false);

  useEffect(() => {
    setTitle("Reader");
    return () => setTitle("");
  }, [setTitle]);

  // ── Fetch paper list ──
  useEffect(() => {
    let cancelled = false;
    setLoadingPapers(true);
    setPapersError(null);

    scholar
      .getPapers({ sort: "year_desc", limit: 1000 })
      .then((res) => {
        if (cancelled) return;
        setPapers(res.papers.map(toPaperRef));
      })
      .catch((e) => {
        if (cancelled) return;
        setPapersError(e instanceof Error ? e.message : "加载失败，请确认 scholaraio serve 已启动");
      })
      .finally(() => {
        if (!cancelled) setLoadingPapers(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // ── Reset detail when paper changes ──
  useEffect(() => {
    setDetail(null);
    setDetailFetched(false);
    setActiveTab("l2");
  }, []);

  // ── Lazy-fetch paper detail when L3 / L4 tab is activated ──
  const fetchDetail = useCallback(() => {
    if (!paperId || detailFetched || loadingDetail) return;
    setLoadingDetail(true);
    setDetailFetched(true);
    scholar
      .getPaper(paperId)
      .then(({ paper }) => {
        setDetail({ content: paper.content, l3Conclusion: paper.l3Conclusion });
      })
      .catch(() => {
        setDetail(null);
      })
      .finally(() => setLoadingDetail(false));
  }, [paperId, detailFetched, loadingDetail]);

  const handleTabChange = useCallback(
    (tab: ReadingTab) => {
      setActiveTab(tab);
      if (tab === "l3" || tab === "l4") fetchDetail();
    },
    [fetchDetail],
  );

  const currentPaper = paperId ? findPaperById(papers, paperId) : undefined;
  const hasPdfFile = currentPaper ? canReadPdf(currentPaper) : false;
  const pdfUrl = paperId ? buildPdfUrl(paperId) : null;

  // ── Main content area renderer ──
  const renderContent = () => {
    if (loadingPapers) {
      return (
        <div className="flex-1 flex items-center justify-center">
          <span className="text-xs font-mono text-on-surface-variant animate-pulse">加载中…</span>
        </div>
      );
    }

    if (papersError) {
      return (
        <div className="flex-1 flex items-center justify-center px-8">
          <div className="rounded-xl bg-error-container/10 border border-error/20 p-6 text-center text-sm text-error max-w-md">
            {papersError}
          </div>
        </div>
      );
    }

    if (!paperId || !currentPaper) {
      return (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-on-surface-variant">请从左侧列表选择一篇文献</p>
        </div>
      );
    }

    if (activeTab === "pdf") {
      if (!hasPdfFile) {
        return (
          <div className="flex-1 flex items-center justify-center">
            <div className="rounded-xl bg-surface-container-low border border-outline-variant/10 p-8 text-center max-w-sm">
              <p className="text-sm font-semibold text-on-surface mb-1">此文献暂无 PDF 原文</p>
              <p className="text-xs text-on-surface-variant mt-1">
                原始 PDF 文件不存在。如已入库，可尝试重新运行 scholaraio pipeline ingest。
              </p>
            </div>
          </div>
        );
      }
      return pdfUrl ? <PdfViewer url={pdfUrl} /> : null;
    }

    return (
      <LayerReader
        paper={currentPaper}
        activeLayer={activeTab}
        detail={detail}
        loadingDetail={loadingDetail}
      />
    );
  };

  return (
    <div className="flex overflow-hidden h-[calc(100vh-3.25rem)]">
      {/* ── Left: paper list sidebar ── */}
      <ReaderSidebar
        papers={papers}
        currentPaperId={paperId ?? ""}
        onBack={() => navigate("/library")}
      />

      {/* ── Right: tab bar + content ── */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {/* Tab bar */}
        {currentPaper || !loadingPapers ? (
          <div className="shrink-0 flex items-center gap-2 px-5 border-b border-outline-variant/15 bg-surface-container-low h-12 overflow-x-auto no-scrollbar">
            {TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              const noPdf = tab.id === "pdf" && !hasPdfFile && !!currentPaper;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => handleTabChange(tab.id)}
                  className={[
                    "shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium transition-colors border cursor-pointer",
                    isActive
                      ? "bg-primary text-on-primary border-primary"
                      : "bg-surface-container-high text-on-surface-variant border-outline-variant/30 hover:bg-surface-container",
                  ].join(" ")}
                >
                  {tab.label}
                  {noPdf ? (
                    <span className="text-[9px] font-mono font-bold bg-error-container/60 text-error px-1 py-0.5 rounded leading-none ml-0.5">
                      无
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : null}

        {/* Content area */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">{renderContent()}</div>
      </div>
    </div>
  );
}
