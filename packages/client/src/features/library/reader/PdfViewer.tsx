// PDF 查看器组件
// 实现原理：使用 react-pdf（基于 pdfjs-dist）渲染 PDF 文件。
// 核心优化：虚拟滚动（只渲染可见页 ± OVERSCAN 页）+ 防抖缩放，
// 避免在大文档中一次性挂载所有 Page 节点造成的性能问题。

import { Minimize2, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
// Vite 的 ?url 后缀将 worker 文件作为静态资源 URL 导入，
// 避免将 pdf.worker 打包进主 bundle，保持 Worker 在独立线程中运行。
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

// 告诉 pdfjs 在哪里加载 Web Worker，Worker 负责解析 PDF 字节流，
// 将繁重的解码工作从主线程转移到后台线程，避免 UI 卡顿。
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

// 缩放档位：预定义一组离散的缩放比例，避免连续值带来的浮点误差。
const ZOOM_STEPS = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];
// 默认使用 1.0（100%），对应数组索引 2。
const DEFAULT_ZOOM_INDEX = 2; // 1.0
// 虚拟滚动超出渲染区：可见范围两侧各多渲染 2 页，
// 使用户快速滚动时新页面已在 DOM 中，不会出现空白闪烁。
const OVERSCAN = 2; // pages to render beyond visible range on each side
// 缩放防抖延迟（毫秒）：连续点击缩放时只有最后一次生效，
// 避免每次点击都触发所有页面的重新渲染。
const DEBOUNCE_MS = 150;

interface Props {
  url: string;
  initialPage?: number;
  onPageChange?: (page: number) => void;
}

export function PdfViewer({ url, initialPage = 1, onPageChange }: Props) {
  // PDF 总页数，由 react-pdf 的 onLoadSuccess 回调提供。
  const [numPages, setNumPages] = useState(0);
  // 当前可见的第一页页码，用于工具栏显示 "当前页 / 总页数"。
  const [currentPage, setCurrentPage] = useState(1);

  // ── 双态缩放设计 ──
  // pendingZoomIndex：点击按钮时立即更新，驱动工具栏百分比数字即时反馈，
  //   让用户感知到操作已被响应，无需等待渲染完成。
  // zoomIndex：防抖后才更新，是真正传给 <Page scale={...}> 的值，
  //   仅在用户停止点击 DEBOUNCE_MS 后才触发所有页的重渲染。
  const [pendingZoomIndex, setPendingZoomIndex] = useState(DEFAULT_ZOOM_INDEX);
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM_INDEX);
  // 用 ref 保存 setTimeout 句柄，在下次缩放触发时先清除上次的定时器。
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 由索引取出实际缩放比例，?? 1.0 防止索引越界时降级到 100%。
  const scale = ZOOM_STEPS[zoomIndex] ?? 1.0;
  const pendingScale = ZOOM_STEPS[pendingZoomIndex] ?? 1.0;

  // 滚动容器的 DOM 引用，作为 IntersectionObserver 的 root，
  // 使可见性检测相对于滚动容器而非视口进行。
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // 虚拟滚动的渲染范围 [起始页, 结束页]（含两端，1-indexed）。
  // 只有 rangeStart ~ rangeEnd 内的页面才会渲染真实的 <Page>，
  // 其余页面渲染等高占位 div，维持滚动条比例不变。
  const [visibleRange, setVisibleRange] = useState<[number, number]>([1, 1]);

  // PDF 文档加载完成回调：
  // 初始化总页数，重置到第 1 页，并设置初始渲染范围为前 1+OVERSCAN 页。
  const onLoadSuccess = useCallback(({ numPages: n }: { numPages: number }) => {
    setNumPages(n);
    setCurrentPage(1);
    setVisibleRange([1, Math.min(1 + OVERSCAN, n)]);
  }, []);

  // ── IntersectionObserver 虚拟滚动实现 ──
  // 使用两个 ref 而非 state 保存 Observer 和可见页集合，
  // 因为它们的变化不需要触发 React 重渲染，只用于内部计算。
  const observerRef = useRef<IntersectionObserver | null>(null);
  // visibleSetRef 保存当前"完全或部分进入滚动容器视口"的页码集合。
  const visibleSetRef = useRef<Set<number>>(new Set());

  // Effect 1（生命周期绑定 numPages）：创建 IntersectionObserver 实例。
  // 之所以与缩放 Effect 分离：Observer 实例应在文档页数不变时复用，
  // 缩放只会重挂载 <Page> 的 DOM 节点，不需要重建 Observer，
  // 只需重新 observe 新的 DOM 节点（见 reobservePages）。
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || numPages === 0) return;

    const visible = visibleSetRef.current;
    visible.clear();

    // root: container 表示以滚动容器为检测视口（而非浏览器视口）。
    // threshold: 0 表示目标元素只要有 1px 进入容器就触发回调，
    // 离开时同样触发，精确追踪进出事件。
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          // 每个页面包裹 div 上设置了 data-page 属性（如 data-page="3"），
          // 通过它识别是哪一页进入或离开视口。
          const n = Number(entry.target.getAttribute("data-page"));
          if (!n) continue;
          if (entry.isIntersecting) {
            visible.add(n);
          } else {
            visible.delete(n);
          }
        }
        if (visible.size === 0) return;
        // 取当前可见页中最小和最大页码，加上 OVERSCAN 扩展渲染范围，
        // 并 clamp 到 [1, numPages] 防止越界。
        const min = Math.min(...visible);
        const max = Math.max(...visible);
        // 更新当前页：以可见范围的最小页码作为"当前页"显示在工具栏。
        setCurrentPage(min);
        setVisibleRange([Math.max(1, min - OVERSCAN), Math.min(numPages, max + OVERSCAN)]);
      },
      { root: container, threshold: 0 },
    );
    observerRef.current = observer;

    // 初始化时观察所有已有的页面包裹节点（[data-page] 选择器）。
    for (const el of container.querySelectorAll("[data-page]")) {
      observer.observe(el);
    }
    // 清理函数：组件卸载或 numPages 变化时断开 Observer，防止内存泄漏。
    return () => {
      observer.disconnect();
      observerRef.current = null;
    };
  }, [numPages]);

  useEffect(() => {
    onPageChange?.(currentPage);
  }, [currentPage, onPageChange]);
  useEffect(() => {
    if (!numPages) return;
    const target = Math.min(Math.max(1, initialPage), numPages);
    const frame = requestAnimationFrame(() => {
      scrollContainerRef.current
        ?.querySelector(`[data-page="${target}"]`)
        ?.scrollIntoView({ block: "start" });
    });
    return () => cancelAnimationFrame(frame);
  }, [initialPage, numPages]);

  // 缩放后重新挂载被观察的 DOM 节点。
  // 缩放改变 scale 后，react-pdf 会卸载旧的 <Page> 并挂载新的，
  // 原来被 observe 的 DOM 节点已从文档中移除，Observer 需要重新 observe 新节点。
  // 通过复用已有的 Observer 实例（而非重建），避免重置可见状态。
  const reobservePages = useCallback(() => {
    const container = scrollContainerRef.current;
    const observer = observerRef.current;
    if (!container || !observer) return;
    // disconnect 取消所有已观察的旧节点（zoom 前的 DOM）。
    observer.disconnect();
    visibleSetRef.current.clear();
    // 重新观察 zoom 后 React 挂载的新 DOM 节点。
    for (const el of container.querySelectorAll("[data-page]")) {
      observer.observe(el);
    }
  }, []);

  // 防抖提交缩放：DEBOUNCE_MS 内连续调用只执行最后一次。
  // 执行流程：清除旧 timer → 设置新 timer → timer 到期时更新 zoomIndex →
  // 等待 React 渲染（两帧）→ 重新观察新 DOM 节点。
  // 用双 requestAnimationFrame 而非 setTimeout(0) 是因为：
  // 第一帧 React commit DOM，第二帧 pdf.js 完成页面布局，
  // 此后观察到的尺寸才是正确的。
  const commitZoom = useCallback(
    (nextIndex: number) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        setZoomIndex(nextIndex);
        // 等两帧：React commit 新 DOM + pdf.js 完成页面布局后再重新 observe。
        requestAnimationFrame(() => requestAnimationFrame(reobservePages));
      }, DEBOUNCE_MS);
    },
    [reobservePages],
  );

  // 缩小：将 pendingZoomIndex 减 1，下限为 0（最小档位）。
  // 同步更新 pending（即时 UI 反馈），异步 commitZoom（防抖后真正渲染）。
  const zoomOut = useCallback(() => {
    setPendingZoomIndex((i) => {
      const next = Math.max(0, i - 1);
      commitZoom(next);
      return next;
    });
  }, [commitZoom]);

  // 放大：将 pendingZoomIndex 加 1，上限为最大档位索引。
  const zoomIn = useCallback(() => {
    setPendingZoomIndex((i) => {
      const next = Math.min(ZOOM_STEPS.length - 1, i + 1);
      commitZoom(next);
      return next;
    });
  }, [commitZoom]);

  // 重置缩放：直接同步更新两个 state，无需防抖，
  // 同时清除可能存在的 pending timer，避免重置后被覆盖。
  const zoomReset = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setPendingZoomIndex(DEFAULT_ZOOM_INDEX);
    setZoomIndex(DEFAULT_ZOOM_INDEX);
  }, []);

  // 组件卸载时清理防抖 timer，防止在已卸载的组件上调用 setState。
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const [rangeStart, rangeEnd] = visibleRange;

  return (
    // 外层容器：flex 列布局，撑满父容器高度，overflow-hidden 防止内容溢出影响外部布局。
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── 工具栏 ── */}
      <div className="shrink-0 flex items-center gap-1 px-4 h-11 bg-surface-container-low border-b border-outline-variant/15">
        {/* 页码显示："当前页 / 总页数"，numPages 为 0 时（加载中）显示破折号 */}
        <span className="text-xs font-mono text-on-surface-variant min-w-[4.5rem] text-center select-none">
          {numPages > 0 ? `${currentPage} / ${numPages}` : "—"}
        </span>

        {/* 分隔线 */}
        <div className="w-px h-4 bg-outline-variant/30 mx-1" />

        {/* 缩小按钮：到最小档时禁用，防止索引越界 */}
        <button
          type="button"
          onClick={zoomOut}
          disabled={pendingZoomIndex === 0}
          aria-label="缩小"
          className="p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-container-high disabled:opacity-30 disabled:cursor-not-allowed transition-colors border-0 bg-transparent cursor-pointer"
        >
          <ZoomOut className="w-4 h-4" />
        </button>

        {/* 缩放比例显示按钮：点击重置为 100%。
            显示 pendingScale（即时响应）而非 scale（防抖后），
            使 UI 数字与用户点击同步，不会滞后 150ms。 */}
        <button
          type="button"
          onClick={zoomReset}
          aria-label="重置缩放"
          className="text-[10px] font-mono text-on-surface-variant min-w-[2.75rem] text-center px-1.5 py-1 rounded-lg hover:bg-surface-container-high transition-colors border-0 bg-transparent cursor-pointer select-none"
        >
          {Math.round(pendingScale * 100)}%
        </button>

        {/* 放大按钮：到最大档时禁用 */}
        <button
          type="button"
          onClick={zoomIn}
          disabled={pendingZoomIndex === ZOOM_STEPS.length - 1}
          aria-label="放大"
          className="p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-container-high disabled:opacity-30 disabled:cursor-not-allowed transition-colors border-0 bg-transparent cursor-pointer"
        >
          <ZoomIn className="w-4 h-4" />
        </button>

        {/* 适应宽度（重置）按钮：图标语义为"还原/最小化"，点击后重置为 100% */}
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

      {/* ── 可滚动页面区域 ── */}
      {/* flex-1 使此区域占据工具栏以下的全部剩余高度，overflow-auto 启用滚动。
          ref 挂载给 IntersectionObserver 作为 root 容器使用。 */}
      <div ref={scrollContainerRef} className="flex-1 overflow-auto bg-surface-container">
        {/* react-pdf Document 组件负责加载 PDF 文件并提供页面上下文。
            file 属性变更时会重新加载，onLoadSuccess 在解析完成后调用。 */}
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
          {/* 页面列表容器：flex 列布局，居中对齐，页间距 gap-4。 */}
          <div className="flex flex-col items-center gap-4 py-6 px-4">
            {Array.from({ length: numPages }, (_, i) => i + 1).map((pageNumber) => {
              // 虚拟滚动核心判断：页码在 [rangeStart, rangeEnd] 内才渲染真实页面。
              const inRange = pageNumber >= rangeStart && pageNumber <= rangeEnd;
              return (
                // 包裹 div 上的 data-page 属性供 IntersectionObserver 识别页码。
                // key 使用 page-${pageNumber} 而非纯数字，确保跨文档加载时 React 正确复用节点。
                <div key={`page-${pageNumber}`} data-page={pageNumber}>
                  {inRange ? (
                    // 在渲染范围内：使用 react-pdf 的 Page 组件真实渲染 PDF 内容。
                    // renderTextLayer：渲染透明文字层，支持文字选中和复制。
                    // renderAnnotationLayer：渲染链接、表单等注释层。
                    // scale 来自防抖后的 zoomIndex，避免 pendingZoom 期间反复重渲。
                    <Page
                      pageNumber={pageNumber}
                      scale={scale}
                      renderTextLayer
                      renderAnnotationLayer
                      className="shadow-xl rounded-sm"
                    />
                  ) : (
                    // 超出渲染范围：渲染等尺寸占位块，维持滚动条高度比例不变，
                    // 防止用户快速滚动时页面高度突变导致位置跳动。
                    // 尺寸基于 A4 纸张标准像素尺寸（794×1123px @ 96dpi）乘以当前 scale，
                    // 与真实 Page 的尺寸匹配，是快速近似而非精确测量。
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
