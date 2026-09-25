import type { ProjectionPoint } from "@scholaraio-hub/shared";
import {
  type D3ZoomEvent,
  type ZoomTransform,
  extent,
  quadtree,
  scaleLinear,
  select,
  zoom,
  zoomIdentity,
} from "d3";
import { Hand, Lasso, Minus, Plus, RotateCcw } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { TopicColorMap } from "../../utils/topicColors";

export interface ScatterPlotData {
  points: ProjectionPoint[];
  activeIds: Set<string> | null;
  selectedId: string | null;
  topicColors: TopicColorMap;
}

export type ScatterMode = "pan" | "lasso";

const HIT_RADIUS = 12;
const POINT_RADIUS = 3;
/** How far the map may be zoomed out and in. */
const ZOOM_EXTENT: [number, number] = [0.8, 16];
const ZOOM_STEP = 1.6;
const ENTRANCE_MS = 700;
const PRIMARY = "#005235";

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const easeOut = (t: number) => 1 - (1 - t) ** 3;

/**
 * The map's imperative half: canvas, scales, zoom and lasso.
 *
 * React hands it data through `update`; everything that changes per frame —
 * the zoom transform, the hovered point, the entrance animation — lives here.
 */
class ScatterPlotController {
  private canvas: HTMLCanvasElement;
  private tooltip: HTMLDivElement;
  private transform: ZoomTransform = zoomIdentity;
  private hoveredPt: ProjectionPoint | null = null;
  private mode: ScatterMode = "pan";
  private dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;

  private xScale = scaleLinear<number, number>().range([40, 560]);
  private yScale = scaleLinear<number, number>().range([360, 40]);
  private qt = quadtree<ProjectionPoint>()
    .x(() => 0)
    .y(() => 0);

  private data: ScatterPlotData = {
    points: [],
    activeIds: null,
    selectedId: null,
    topicColors: new Map(),
  };

  private pointsRef: ProjectionPoint[] = [];
  private lassoPath: [number, number][] = [];
  private frozenLassoPath: [number, number][] = [];
  private lassoSelectedIds: Set<string> | null = null;
  private isLassoing = false;
  /** 0 → 1 while points grow in after new data arrives. */
  private appear = 1;
  private frame = 0;

  private resizeObserver: ResizeObserver;
  private zoomBehavior = zoom<HTMLCanvasElement, unknown>()
    .scaleExtent(ZOOM_EXTENT)
    // Lasso mode keeps the wheel for zooming; dragging draws the lasso instead.
    .filter((event: Event) =>
      this.mode === "lasso"
        ? event.type === "wheel"
        : !(event as MouseEvent).button && !(event as MouseEvent).ctrlKey,
    )
    .on("zoom", (e: D3ZoomEvent<HTMLCanvasElement, unknown>) => {
      this.transform = e.transform;
      this.hideTooltip();
      this.draw();
    });

  constructor(
    container: HTMLElement,
    private onPointClick: (id: string) => void,
    private onLassoSelect: (ids: Set<string>) => void,
  ) {
    this.canvas = document.createElement("canvas");
    this.canvas.style.cssText = "display:block;width:100%;height:100%;cursor:grab";
    container.appendChild(this.canvas);
    container.style.position = "relative";

    this.tooltip = document.createElement("div");
    this.tooltip.style.cssText =
      "pointer-events:none;position:absolute;z-index:10;opacity:0;transition:opacity 120ms ease;background:var(--color-surface-container-lowest);border:1px solid color-mix(in srgb, var(--color-outline-variant) 40%, transparent);box-shadow:0 8px 24px rgba(23,29,26,0.12);border-radius:8px;padding:4px 8px;font-size:11px;max-width:260px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--color-on-surface)";
    container.appendChild(this.tooltip);

    this.canvas.addEventListener("mousemove", this.onMouseMove);
    this.canvas.addEventListener("mousedown", this.onMouseDown);
    this.canvas.addEventListener("mouseup", this.onMouseUp);
    this.canvas.addEventListener("click", this.onMouseClick);
    this.canvas.addEventListener("mouseleave", this.onMouseLeave);
    select(this.canvas).call(this.zoomBehavior).on("dblclick.zoom", null);

    this.resizeObserver = new ResizeObserver((entries) => {
      const { width, height } = entries[0]?.contentRect || { width: 0, height: 0 };
      if (width > 0 && height > 0) this.resize(width, height);
    });
    this.resizeObserver.observe(container);

    const rect = container.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) this.resize(rect.width, rect.height);
  }

  resetZoom() {
    this.frozenLassoPath = [];
    this.lassoSelectedIds = null;
    select(this.canvas)
      .transition()
      .duration(reducedMotion() ? 0 : 350)
      .call(this.zoomBehavior.transform, zoomIdentity);
    this.draw();
  }

  zoomBy(factor: number) {
    select(this.canvas)
      .transition()
      .duration(reducedMotion() ? 0 : 250)
      .call(this.zoomBehavior.scaleBy, factor);
  }

  clearLasso() {
    this.frozenLassoPath = [];
    this.lassoSelectedIds = null;
    this.draw();
  }

  setMode(mode: ScatterMode) {
    this.mode = mode;
    this.lassoPath = [];
    this.isLassoing = false;
    this.hoveredPt = null;
    this.hideTooltip();
    this.canvas.style.cursor = mode === "lasso" ? "crosshair" : "grab";
    this.draw();
  }

  update(data: ScatterPlotData) {
    this.data = data;
    if (data.points !== this.pointsRef) {
      this.pointsRef = data.points;
      this.frozenLassoPath = [];
      this.lassoSelectedIds = null;
      this.transform = zoomIdentity;
      select(this.canvas).call(this.zoomBehavior.transform, zoomIdentity);
      this.updateView();
      this.animateIn();
    } else {
      this.draw();
    }
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    select(this.canvas).on(".zoom", null).interrupt();
    this.canvas.removeEventListener("mousemove", this.onMouseMove);
    this.canvas.removeEventListener("mousedown", this.onMouseDown);
    this.canvas.removeEventListener("mouseup", this.onMouseUp);
    this.canvas.removeEventListener("click", this.onMouseClick);
    this.canvas.removeEventListener("mouseleave", this.onMouseLeave);
    this.canvas.remove();
    this.tooltip.remove();
  }

  /** Grow the points in from nothing, so new data arrives rather than appears. */
  private animateIn() {
    cancelAnimationFrame(this.frame);
    if (reducedMotion() || !this.data.points.length) {
      this.appear = 1;
      this.draw();
      return;
    }
    const start = performance.now();
    const step = (now: number) => {
      // A frame's timestamp is when the frame began, which can precede `start`;
      // unclamped, the first frame's radius goes negative, arc() throws, and
      // the animation (and the map) stops there, blank.
      this.appear = Math.min(1, Math.max(0, (now - start) / ENTRANCE_MS));
      this.draw();
      if (this.appear < 1) this.frame = requestAnimationFrame(step);
    };
    this.appear = 0;
    this.frame = requestAnimationFrame(step);
  }

  private hideTooltip() {
    this.tooltip.style.opacity = "0";
  }

  private resize(w: number, h: number) {
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.floor(w * this.dpr);
    this.canvas.height = Math.floor(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    // Panning stops a little past the map's edge instead of losing it off-screen.
    this.zoomBehavior
      .extent([
        [0, 0],
        [w, h],
      ])
      .translateExtent([
        [-w * 0.25, -h * 0.25],
        [w * 1.25, h * 1.25],
      ]);
    this.updateView();
  }

  private updateView() {
    const { points } = this.data;
    const w = this.canvas.width / this.dpr || 1;
    const h = this.canvas.height / this.dpr || 1;
    const pad = 28;

    if (points.length) {
      const [xMin, xMax] = extent(points, (p) => p.x) as [number, number];
      const [yMin, yMax] = extent(points, (p) => p.y) as [number, number];
      const xPad = (xMax - xMin) * 0.04 || 0.1;
      const yPad = (yMax - yMin) * 0.04 || 0.1;
      this.xScale.domain([xMin - xPad, xMax + xPad]).range([pad, w - pad]);
      this.yScale.domain([yMin - yPad, yMax + yPad]).range([h - pad, pad]);
      this.qt = quadtree<ProjectionPoint>()
        .x((p) => this.xScale(p.x))
        .y((p) => this.yScale(p.y))
        .addAll(points);
    } else {
      this.xScale.domain([-1, 1]).range([pad, w - pad]);
      this.yScale.domain([-1, 1]).range([h - pad, pad]);
    }
    this.draw();
  }

  private draw() {
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    const { points, activeIds, selectedId, topicColors } = this.data;
    const t = this.transform;
    const effectiveActive = this.lassoSelectedIds ?? activeIds;
    const grow = easeOut(this.appear);
    // Points grow slightly with zoom, so a close look is not a scatter of specks.
    const radius = POINT_RADIUS * Math.min(2, Math.max(1, Math.sqrt(t.k))) * grow;

    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.save();
    ctx.scale(this.dpr, this.dpr);

    let selectedPt: ProjectionPoint | null = null;
    const drawPt = (pt: ProjectionPoint, r: number) => {
      ctx.fillStyle = topicColors.get(pt.topicId) ?? "#bfc9c0";
      ctx.beginPath();
      ctx.arc(t.applyX(this.xScale(pt.x)), t.applyY(this.yScale(pt.y)), r, 0, Math.PI * 2);
      ctx.fill();
    };

    // Points outside the current selection recede.
    if (effectiveActive) {
      ctx.globalAlpha = 0.12 * grow;
      for (const pt of points) {
        if (pt.id === selectedId) selectedPt = pt;
        if (!effectiveActive.has(pt.id)) drawPt(pt, radius);
      }
    }

    ctx.globalAlpha = 0.9 * grow;
    for (const pt of points) {
      if (!effectiveActive || effectiveActive.has(pt.id)) {
        if (pt.id === selectedId) selectedPt = pt;
        if (pt !== this.hoveredPt && pt !== selectedPt) drawPt(pt, radius);
      }
    }
    ctx.globalAlpha = 1;

    if (this.hoveredPt) {
      const cx = t.applyX(this.xScale(this.hoveredPt.x));
      const cy = t.applyY(this.yScale(this.hoveredPt.y));
      ctx.fillStyle = topicColors.get(this.hoveredPt.topicId) ?? "#bfc9c0";
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, radius + 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    if (selectedPt) {
      const cx = t.applyX(this.xScale(selectedPt.x));
      const cy = t.applyY(this.yScale(selectedPt.y));
      ctx.strokeStyle = PRIMARY;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, radius + 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = topicColors.get(selectedPt.topicId) ?? PRIMARY;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();

    const drawLassoPath = (path: [number, number][], frozen: boolean) => {
      const first = path[0];
      if (path.length < 2 || !first) return;
      const dpr = this.dpr;
      ctx.save();
      ctx.strokeStyle = PRIMARY;
      ctx.lineWidth = (frozen ? 1.5 : 2) * dpr;
      ctx.setLineDash(frozen ? [] : [6 * dpr, 4 * dpr]);
      ctx.fillStyle = frozen ? "rgba(0,82,53,0.05)" : "rgba(0,82,53,0.08)";
      ctx.beginPath();
      ctx.moveTo(t.applyX(first[0]) * dpr, t.applyY(first[1]) * dpr);
      for (let i = 1; i < path.length; i++) {
        const pt = path[i];
        if (pt) ctx.lineTo(t.applyX(pt[0]) * dpr, t.applyY(pt[1]) * dpr);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    };

    if (this.lassoPath.length > 1) drawLassoPath(this.lassoPath, false);
    if (this.frozenLassoPath.length > 1) drawLassoPath(this.frozenLassoPath, true);
  }

  private commitLasso() {
    if (!this.isLassoing) return;
    this.isLassoing = false;

    if (this.lassoPath.length > 2) {
      const selected = new Set<string>();
      const path = this.lassoPath;
      for (const pt of this.data.points) {
        const px = this.xScale(pt.x);
        const py = this.yScale(pt.y);
        let inside = false;
        // Ray casting: count how many polygon edges a ray from the point crosses.
        for (let i = 0, j = path.length - 1; i < path.length; j = i++) {
          const pi = path[i];
          const pj = path[j];
          if (!pi || !pj) continue;
          const [xi, yi] = pi;
          const [xj, yj] = pj;
          if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)
            inside = !inside;
        }
        if (inside) selected.add(pt.id);
      }
      this.frozenLassoPath = [...path];
      this.lassoSelectedIds = selected;
      this.onLassoSelect(selected);
    }
    this.lassoPath = [];
    this.draw();
  }

  private onMouseDown = (e: MouseEvent) => {
    if (this.mode === "pan") {
      this.canvas.style.cursor = "grabbing";
      return;
    }
    const rect = this.canvas.getBoundingClientRect();
    this.isLassoing = true;
    this.frozenLassoPath = [];
    this.lassoSelectedIds = null;
    this.lassoPath = [
      [this.transform.invertX(e.clientX - rect.left), this.transform.invertY(e.clientY - rect.top)],
    ];
  };

  private onMouseUp = () => {
    if (this.mode === "lasso") this.commitLasso();
    else this.canvas.style.cursor = "grab";
  };

  private onMouseLeave = () => {
    if (this.mode === "lasso") this.commitLasso();
    this.hoveredPt = null;
    this.hideTooltip();
    this.draw();
  };

  private onMouseMove = (e: MouseEvent) => {
    const rect = this.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    if (this.mode === "lasso" && this.isLassoing) {
      this.lassoPath.push([this.transform.invertX(mx), this.transform.invertY(my)]);
      this.draw();
      return;
    }
    if (e.buttons) return;

    const pt =
      this.qt.find(
        this.transform.invertX(mx),
        this.transform.invertY(my),
        HIT_RADIUS / (this.transform.k || 1),
      ) ?? null;
    if (pt === this.hoveredPt) return;
    this.hoveredPt = pt;
    if (pt) {
      this.tooltip.style.left = `${Math.min(mx + 12, rect.width - 200)}px`;
      this.tooltip.style.top = `${my - 28}px`;
      this.tooltip.textContent = pt.year ? `${pt.title || pt.id} · ${pt.year}` : pt.title || pt.id;
      this.tooltip.style.opacity = "1";
      if (this.mode === "pan") this.canvas.style.cursor = "pointer";
    } else {
      this.hideTooltip();
      if (this.mode === "pan") this.canvas.style.cursor = "grab";
    }
    this.draw();
  };

  private onMouseClick = (e: MouseEvent) => {
    if (this.mode !== "pan" || e.defaultPrevented) return;
    const rect = this.canvas.getBoundingClientRect();
    const pt = this.qt.find(
      this.transform.invertX(e.clientX - rect.left),
      this.transform.invertY(e.clientY - rect.top),
      HIT_RADIUS / (this.transform.k || 1),
    );
    if (pt) this.onPointClick(pt.id);
  };
}

export interface ScatterPlotRef {
  clearLasso: () => void;
}

interface ScatterPlotProps {
  points: ProjectionPoint[];
  activeIds: Set<string> | null;
  selectedId: string | null;
  topicColors: TopicColorMap;
  onPointClick: (id: string) => void;
  onLassoSelect?: (ids: Set<string>) => void;
  onReset?: () => void;
}

const toolClass = (active = false) =>
  `p-1.5 rounded-md transition-colors ${
    active
      ? "bg-primary/15 text-primary"
      : "text-on-surface-variant hover:bg-surface-container-high"
  }`;

export const ScatterPlot = forwardRef<ScatterPlotRef, ScatterPlotProps>(
  ({ points, activeIds, selectedId, topicColors, onPointClick, onLassoSelect, onReset }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const controllerRef = useRef<ScatterPlotController | null>(null);
    const [mode, setMode] = useState<ScatterMode>("pan");

    const callbacks = useRef({ onPointClick, onLassoSelect });
    callbacks.current = { onPointClick, onLassoSelect };

    useImperativeHandle(
      ref,
      () => ({
        clearLasso: () => controllerRef.current?.clearLasso(),
      }),
      [],
    );

    useEffect(() => {
      if (!containerRef.current) return;
      const ctrl = new ScatterPlotController(
        containerRef.current,
        (id) => callbacks.current.onPointClick(id),
        (ids) => callbacks.current.onLassoSelect?.(ids),
      );
      controllerRef.current = ctrl;
      return () => {
        ctrl.destroy();
        controllerRef.current = null;
      };
    }, []);

    useEffect(() => {
      controllerRef.current?.setMode(mode);
    }, [mode]);

    useEffect(() => {
      controllerRef.current?.update({ points, activeIds, selectedId, topicColors });
    }, [points, activeIds, selectedId, topicColors]);

    return (
      <div className="relative h-full w-full">
        <div ref={containerRef} className="h-full w-full" />
        <div className="absolute right-2 top-2 flex items-center gap-0.5 p-0.5">
          <button
            type="button"
            aria-label="平移与点选"
            aria-pressed={mode === "pan"}
            title="拖动平移、滚轮缩放、点击查看"
            onClick={() => setMode("pan")}
            className={toolClass(mode === "pan")}
          >
            <Hand className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            aria-label="套索选择"
            aria-pressed={mode === "lasso"}
            title="套索选择"
            onClick={() => setMode((prev) => (prev === "lasso" ? "pan" : "lasso"))}
            className={toolClass(mode === "lasso")}
          >
            <Lasso className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            aria-label="放大"
            title="放大"
            onClick={() => controllerRef.current?.zoomBy(ZOOM_STEP)}
            className={toolClass()}
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            aria-label="缩小"
            title="缩小"
            onClick={() => controllerRef.current?.zoomBy(1 / ZOOM_STEP)}
            className={toolClass()}
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            aria-label="重置视图"
            title="重置"
            onClick={() => {
              setMode("pan");
              controllerRef.current?.resetZoom();
              onReset?.();
            }}
            className={toolClass()}
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  },
);
