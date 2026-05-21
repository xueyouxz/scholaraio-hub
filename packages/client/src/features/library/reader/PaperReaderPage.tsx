import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { usePageTitle } from "../../../app/components/NavigationLayout";
import { scholar } from "../../../core/api";
import { queryKeys } from "../../../core/queryKeys";
import { buildPdfUrl, canReadPdf, findPaperById, toPaperRef } from "../paperUtils";
import type { PaperDetail, PaperReference, ReadingTab } from "../types";
import { LayerReader } from "./LayerReader";
import { PdfViewer } from "./PdfViewer";

// ─── Tab definitions ──────────────────────────────────────────────────────────

const TABS: { id: ReadingTab; label: string }[] = [
  { id: "overview", label: "概览" },
  { id: "l4", label: "全文" },
  { id: "pdf", label: "PDF" },
];
const PAPER_LIST_PARAMS = { sort: "year_desc", limit: 1000 };
const L3_CONTENT_PARAMS = { layer: 3 } as const;
const L4_CONTENT_PARAMS = { layer: 4 } as const;

function contentToText(content: unknown): string | undefined {
  return typeof content === "string" ? content : undefined;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PaperReaderPage() {
  const { paperId } = useParams<{ paperId: string }>();
  const navigate = useNavigate();
  const { setTitle } = usePageTitle();

  const [activeTab, setActiveTab] = useState<ReadingTab>("overview");

  useEffect(() => {
    setTitle("Reader");
    return () => setTitle("");
  }, [setTitle]);

  useEffect(() => {
    if (paperId !== undefined) {
      setActiveTab("overview");
    }
  }, [paperId]);

  const papersQuery = useQuery({
    queryKey: queryKeys.scholar.papers(PAPER_LIST_PARAMS),
    queryFn: ({ signal }) => scholar.getPapers(PAPER_LIST_PARAMS, { signal }),
    select: (res) => res.papers.map(toPaperRef),
  });

  const l3Query = useQuery({
    queryKey: paperId
      ? queryKeys.scholar.paperContent(paperId, L3_CONTENT_PARAMS)
      : ["scholar", "paper", "idle", "content", L3_CONTENT_PARAMS],
    queryFn: ({ signal }) => {
      if (!paperId) throw new Error("Missing paper id");
      return scholar.getPaperContent(paperId, L3_CONTENT_PARAMS, { signal });
    },
    enabled: !!paperId && activeTab === "overview",
  });

  const l4Query = useQuery({
    queryKey: paperId
      ? queryKeys.scholar.paperContent(paperId, L4_CONTENT_PARAMS)
      : ["scholar", "paper", "idle", "content", L4_CONTENT_PARAMS],
    queryFn: ({ signal }) => {
      if (!paperId) throw new Error("Missing paper id");
      return scholar.getPaperContent(paperId, L4_CONTENT_PARAMS, { signal });
    },
    enabled: !!paperId && activeTab === "l4",
  });

  const handleTabChange = (tab: ReadingTab) => {
    setActiveTab(tab);
  };

  const papers: PaperReference[] = papersQuery.data ?? [];
  const loadingPapers = papersQuery.isLoading;
  const papersError =
    papersQuery.error instanceof Error
      ? papersQuery.error.message
      : papersQuery.error
        ? "加载失败，请确认 scholaraio serve 已启动"
        : null;
  const currentPaper = paperId ? findPaperById(papers, paperId) : undefined;
  const hasPdfFile = currentPaper ? canReadPdf(currentPaper) : false;
  const pdfUrl = paperId ? buildPdfUrl(paperId) : null;
  const detail: PaperDetail | null =
    activeTab === "overview"
      ? { l3Conclusion: contentToText(l3Query.data?.content) }
      : activeTab === "l4"
        ? { content: contentToText(l4Query.data?.content) }
        : null;
  const loadingDetail =
    activeTab === "overview" ? l3Query.isFetching : activeTab === "l4" && l4Query.isFetching;

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
          <p className="text-sm text-on-surface-variant">未找到该文献</p>
        </div>
      );
    }

    if (activeTab === "pdf") {
      return pdfUrl ? <PdfViewer url={pdfUrl} /> : null;
    }

    return (
      <LayerReader
        paper={currentPaper}
        paperId={paperId}
        activeLayer={activeTab}
        detail={detail}
        loadingDetail={loadingDetail}
      />
    );
  };

  return (
    <div className="flex overflow-hidden h-[calc(100vh-3.25rem)]">
      {/* ── Tab bar + content ── */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {/* Tab bar */}
        {currentPaper || !loadingPapers ? (
          <div className="shrink-0 flex items-center gap-2 px-5 border-b border-outline-variant/15 bg-surface-container-low h-12 overflow-x-auto no-scrollbar">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors border cursor-pointer bg-surface-container-high text-on-surface-variant border-outline-variant/30 hover:bg-surface-container"
            >
              ← 返回
            </button>
            <div className="shrink-0 w-px h-4 bg-outline-variant/30" />
            {TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              const isPdfDisabled = tab.id === "pdf" && !hasPdfFile && !!currentPaper;
              const label = isPdfDisabled ? "无PDF" : tab.label;

              if (isPdfDisabled) {
                return (
                  <span
                    key={tab.id}
                    className="shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border border-outline-variant/10 bg-surface-container-low text-on-surface-variant/30 cursor-not-allowed select-none"
                  >
                    {label}
                  </span>
                );
              }

              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => handleTabChange(tab.id)}
                  className={[
                    "shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors border cursor-pointer",
                    isActive
                      ? "bg-primary text-on-primary border-primary"
                      : "bg-surface-container-high text-on-surface-variant border-outline-variant/30 hover:bg-surface-container",
                  ].join(" ")}
                >
                  {label}
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
