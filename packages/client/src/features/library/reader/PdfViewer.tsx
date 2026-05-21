import { Minimize2, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const ZOOM_STEPS = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];
const DEFAULT_ZOOM_INDEX = 2; // 1.0

interface Props {
  url: string;
}

function getPageNumbers(numPages: number): number[] {
  const pages: number[] = [];
  for (let pageNumber = 1; pageNumber <= numPages; pageNumber += 1) {
    pages.push(pageNumber);
  }
  return pages;
}

export function PdfViewer({ url }: Props) {
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM_INDEX);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const scale = ZOOM_STEPS[zoomIndex] ?? 1.0;

  const onLoadSuccess = useCallback(({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    setCurrentPage(1);
  }, []);

  // Track which page is centered in the viewport via IntersectionObserver.
  // rootMargin clips the observation zone to a thin band at the vertical center,
  // so the page whose midpoint crosses that band becomes "current".
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || numPages === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const n = Number(entry.target.getAttribute("data-page"));
            if (n) setCurrentPage(n);
          }
        }
      },
      { root: container, rootMargin: "-45% 0px -45% 0px" },
    );

    for (const el of container.querySelectorAll("[data-page]")) {
      observer.observe(el);
    }
    return () => observer.disconnect();
  }, [numPages]);

  const zoomOut = useCallback(() => setZoomIndex((i) => Math.max(0, i - 1)), []);
  const zoomIn = useCallback(() => setZoomIndex((i) => Math.min(ZOOM_STEPS.length - 1, i + 1)), []);
  const zoomReset = useCallback(() => setZoomIndex(DEFAULT_ZOOM_INDEX), []);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Toolbar ── */}
      <div className="shrink-0 flex items-center gap-1 px-4 h-11 bg-surface-container-low border-b border-outline-variant/15">
        {/* Page indicator (read-only, updated by scroll) */}
        <span className="text-xs font-mono text-on-surface-variant min-w-[4.5rem] text-center select-none">
          {numPages > 0 ? `${currentPage} / ${numPages}` : "—"}
        </span>

        <div className="w-px h-4 bg-outline-variant/30 mx-1" />

        {/* Zoom */}
        <button
          type="button"
          onClick={zoomOut}
          disabled={zoomIndex === 0}
          aria-label="缩小"
          className="p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-container-high disabled:opacity-30 disabled:cursor-not-allowed transition-colors border-0 bg-transparent cursor-pointer"
        >
          <ZoomOut className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={zoomReset}
          aria-label="重置缩放"
          className="text-[10px] font-mono text-on-surface-variant min-w-[2.75rem] text-center px-1.5 py-1 rounded-lg hover:bg-surface-container-high transition-colors border-0 bg-transparent cursor-pointer select-none"
        >
          {Math.round(scale * 100)}%
        </button>

        <button
          type="button"
          onClick={zoomIn}
          disabled={zoomIndex === ZOOM_STEPS.length - 1}
          aria-label="放大"
          className="p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-container-high disabled:opacity-30 disabled:cursor-not-allowed transition-colors border-0 bg-transparent cursor-pointer"
        >
          <ZoomIn className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={zoomReset}
          aria-label="适应宽度"
          title="重置为 100%"
          className="p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-container-high transition-colors border-0 bg-transparent cursor-pointer ml-0.5"
        >
          <Minimize2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* ── Scrollable pages ── */}
      <div ref={scrollContainerRef} className="flex-1 overflow-auto bg-surface-container">
        <Document
          file={url}
          onLoadSuccess={onLoadSuccess}
          loading={
            <div className="flex items-center justify-center py-20">
              <span className="text-xs font-mono text-on-surface-variant animate-pulse">
                加载中…
              </span>
            </div>
          }
          error={
            <div className="flex items-center justify-center py-20">
              <span className="text-xs font-mono text-error">PDF 加载失败，请确认文件存在</span>
            </div>
          }
        >
          <div className="flex flex-col items-center gap-4 py-6 px-4">
            {getPageNumbers(numPages).map((pageNumber) => (
              <div key={`page-${pageNumber}`} data-page={pageNumber}>
                <Page
                  pageNumber={pageNumber}
                  scale={scale}
                  renderTextLayer
                  renderAnnotationLayer
                  className="shadow-xl rounded-sm"
                />
              </div>
            ))}
          </div>
        </Document>
      </div>
    </div>
  );
}
