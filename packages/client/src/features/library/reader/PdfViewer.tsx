import { Minimize2, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const ZOOM_STEPS = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];
const DEFAULT_ZOOM_INDEX = 2; // 1.0
const OVERSCAN = 2; // pages to render beyond visible range on each side
const DEBOUNCE_MS = 150;

interface Props {
  url: string;
}

export function PdfViewer({ url }: Props) {
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);

  // zoomIndex is the "committed" scale used for rendering.
  // pendingZoomIndex is updated immediately on click for UI feedback;
  // zoomIndex follows after DEBOUNCE_MS to avoid re-rendering every page on
  // each rapid click.
  const [pendingZoomIndex, setPendingZoomIndex] = useState(DEFAULT_ZOOM_INDEX);
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM_INDEX);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scale = ZOOM_STEPS[zoomIndex] ?? 1.0;
  const pendingScale = ZOOM_STEPS[pendingZoomIndex] ?? 1.0;

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Visible page range for virtual scrolling.
  const [visibleRange, setVisibleRange] = useState<[number, number]>([1, 1]);

  const onLoadSuccess = useCallback(({ numPages: n }: { numPages: number }) => {
    setNumPages(n);
    setCurrentPage(1);
    setVisibleRange([1, Math.min(1 + OVERSCAN, n)]);
  }, []);

  // Track visible range via IntersectionObserver. Split into two effects so the
  // observer survives zoom changes: one creates the observer (lifetime tied to
  // numPages), the other re-observes page wrappers after zoom remounts them.
  const observerRef = useRef<IntersectionObserver | null>(null);
  const visibleSetRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || numPages === 0) return;

    const visible = visibleSetRef.current;
    visible.clear();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const n = Number(entry.target.getAttribute("data-page"));
          if (!n) continue;
          if (entry.isIntersecting) {
            visible.add(n);
          } else {
            visible.delete(n);
          }
        }
        if (visible.size === 0) return;
        const min = Math.min(...visible);
        const max = Math.max(...visible);
        setCurrentPage(min);
        setVisibleRange([Math.max(1, min - OVERSCAN), Math.min(numPages, max + OVERSCAN)]);
      },
      { root: container, threshold: 0 },
    );
    observerRef.current = observer;

    for (const el of container.querySelectorAll("[data-page]")) {
      observer.observe(el);
    }
    return () => {
      observer.disconnect();
      observerRef.current = null;
    };
  }, [numPages]);

  // Re-observe page wrappers against the new DOM nodes that React mounts after
  // a zoom change. Triggered imperatively from commitZoom so the observer
  // instance survives the zoom (only its observed targets are refreshed).
  const reobservePages = useCallback(() => {
    const container = scrollContainerRef.current;
    const observer = observerRef.current;
    if (!container || !observer) return;
    observer.disconnect();
    visibleSetRef.current.clear();
    for (const el of container.querySelectorAll("[data-page]")) {
      observer.observe(el);
    }
  }, []);

  const commitZoom = useCallback(
    (nextIndex: number) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        setZoomIndex(nextIndex);
        // Wait two frames for React to commit the new DOM and pdf.js to lay
        // out the remounted pages before re-observing.
        requestAnimationFrame(() => requestAnimationFrame(reobservePages));
      }, DEBOUNCE_MS);
    },
    [reobservePages],
  );

  const zoomOut = useCallback(() => {
    setPendingZoomIndex((i) => {
      const next = Math.max(0, i - 1);
      commitZoom(next);
      return next;
    });
  }, [commitZoom]);

  const zoomIn = useCallback(() => {
    setPendingZoomIndex((i) => {
      const next = Math.min(ZOOM_STEPS.length - 1, i + 1);
      commitZoom(next);
      return next;
    });
  }, [commitZoom]);

  const zoomReset = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setPendingZoomIndex(DEFAULT_ZOOM_INDEX);
    setZoomIndex(DEFAULT_ZOOM_INDEX);
  }, []);

  // Clean up pending debounce on unmount.
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const [rangeStart, rangeEnd] = visibleRange;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Toolbar ── */}
      <div className="shrink-0 flex items-center gap-1 px-4 h-11 bg-surface-container-low border-b border-outline-variant/15">
        <span className="text-xs font-mono text-on-surface-variant min-w-[4.5rem] text-center select-none">
          {numPages > 0 ? `${currentPage} / ${numPages}` : "—"}
        </span>

        <div className="w-px h-4 bg-outline-variant/30 mx-1" />

        <button
          type="button"
          onClick={zoomOut}
          disabled={pendingZoomIndex === 0}
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
          {Math.round(pendingScale * 100)}%
        </button>

        <button
          type="button"
          onClick={zoomIn}
          disabled={pendingZoomIndex === ZOOM_STEPS.length - 1}
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
            {Array.from({ length: numPages }, (_, i) => i + 1).map((pageNumber) => {
              const inRange = pageNumber >= rangeStart && pageNumber <= rangeEnd;
              return (
                <div key={`page-${pageNumber}`} data-page={pageNumber}>
                  {inRange ? (
                    <Page
                      pageNumber={pageNumber}
                      scale={scale}
                      renderTextLayer
                      renderAnnotationLayer
                      className="shadow-xl rounded-sm"
                    />
                  ) : (
                    // Placeholder keeps scroll position stable while page is offscreen.
                    // Height is approximated from the previous render; pdfjs reports
                    // page dimensions via onRenderSuccess but we use a fixed estimate
                    // (A4 at 96dpi × scale) as a fast approximation.
                    <div
                      style={{ width: Math.round(794 * scale), height: Math.round(1123 * scale) }}
                      className="bg-surface-container-high shadow-xl rounded-sm"
                    />
                  )}
                </div>
              );
            })}
          </div>
        </Document>
      </div>
    </div>
  );
}
