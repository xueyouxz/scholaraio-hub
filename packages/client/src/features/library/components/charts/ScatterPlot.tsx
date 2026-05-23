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
import { Lasso, RotateCcw, ZoomIn } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { ScholarProjectionPoint } from "../../../../core/api";
import type { TopicColorMap } from "../../types";

export interface ScatterPlotData {
  points: ScholarProjectionPoint[];
  activeIds: Set<string> | null;
  selectedId: string | null;
  topicColors: TopicColorMap;
}

export type ScatterMode = "none" | "zoom" | "lasso";

const DPR = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
const HIT_RADIUS = 12;

class ScatterPlotController {
  private canvas: HTMLCanvasElement;
  private tooltip: HTMLDivElement;
  private transform: ZoomTransform = zoomIdentity;
  private hoveredPt: ScholarProjectionPoint | null = null;
  private mode: ScatterMode = "none";

  private xScale = scaleLinear<number, number>().range([40, 560]);
  private yScale = scaleLinear<number, number>().range([360, 40]);
  private qt = quadtree<ScholarProjectionPoint>()
    .x(() => 0)
    .y(() => 0);

  private data: ScatterPlotData = {
    points: [],
    activeIds: null,
    selectedId: null,
    topicColors: new Map(),
  };

  private pointsRef: ScholarProjectionPoint[] = [];
  private lassoPath: [number, number][] = [];
  private frozenLassoPath: [number, number][] = [];
  private lassoSelectedIds: Set<string> | null = null;
  private isLassoing = false;

  private resizeObserver: ResizeObserver;
  private zoomBehavior = zoom<HTMLCanvasElement, unknown>()
    .scaleExtent([0.3, 20])
    .on("zoom", (e: D3ZoomEvent<HTMLCanvasElement, unknown>) => {
      this.transform = e.transform;
      this.draw();
    });

  constructor(
    container: HTMLElement,
    private onPointClick: (id: string) => void,
    private onLassoSelect: (ids: Set<string>) => void,
  ) {
    this.canvas = document.createElement("canvas");
    this.canvas.style.cssText = "display:block;cursor:default;width:100%;height:100%";
    container.appendChild(this.canvas);
    container.style.position = "relative";

    this.tooltip = document.createElement("div");
    this.tooltip.style.cssText =
      "pointer-events:none;position:absolute;display:none;z-index:10;background:var(--color-surface-container-high,#1e1e1e);border:1px solid rgba(0,0,0,0.12);border-radius:8px;padding:2px 8px;font-size:11px;max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
    container.appendChild(this.tooltip);

    this.canvas.addEventListener("mousemove", this.onMouseMove);
    this.canvas.addEventListener("mousedown", this.onMouseDown);
    this.canvas.addEventListener("mouseup", this.onMouseUp);
    this.canvas.addEventListener("click", this.onMouseClick);
    this.canvas.addEventListener("mouseleave", this.onMouseLeave);

    this.resizeObserver = new ResizeObserver((entries) => {
      const { width, height } = entries[0]?.contentRect || { width: 0, height: 0 };
      if (width > 0 && height > 0) this.resize(width, height);
    });
    this.resizeObserver.observe(container);

    const rect = container.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) this.resize(rect.width, rect.height);
  }

  resetZoom() {
    select(this.canvas).transition().duration(250).call(this.zoomBehavior.transform, zoomIdentity);
  }

  setMode(mode: ScatterMode) {
    this.mode = mode;
    this.lassoPath = [];
    this.isLassoing = false;
    this.hoveredPt = null;
    this.tooltip.style.display = "none";

    if (mode === "none") {
      this.frozenLassoPath = [];
      this.lassoSelectedIds = null;
    }

    const sel = select(this.canvas);
    mode === "zoom" ? sel.call(this.zoomBehavior) : sel.on(".zoom", null);
    this.canvas.style.cursor =
      mode === "lasso" ? "crosshair" : mode === "zoom" ? "crosshair" : "default";

    this.draw();
  }

  update(data: ScatterPlotData) {
    this.data = data;
    if (data.points !== this.pointsRef) {
      this.pointsRef = data.points;
      this.transform = zoomIdentity;
      this.updateView();
    } else {
      this.draw();
    }
  }

  destroy() {
    this.resizeObserver.disconnect();
    this.canvas.remove();
    this.tooltip.remove();
  }

  private resize(w: number, h: number) {
    this.canvas.width = Math.floor(w) * DPR;
    this.canvas.height = Math.floor(h) * DPR;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.updateView();
  }

  private updateView() {
    const { points } = this.data;
    const w = this.canvas.width / DPR || 1;
    const h = this.canvas.height / DPR || 1;

    if (points.length) {
      const [xMin, xMax] = extent(points, (p) => p.x) as [number, number];
      const [yMin, yMax] = extent(points, (p) => p.y) as [number, number];
      const xPad = (xMax - xMin) * 0.05 || 0.1;
      const yPad = (yMax - yMin) * 0.05 || 0.1;

      this.xScale.domain([xMin - xPad, xMax + xPad]).range([40, w - 40]);
      this.yScale.domain([yMin - yPad, yMax + yPad]).range([h - 40, 40]);

      this.qt = quadtree<ScholarProjectionPoint>()
        .x((p) => this.xScale(p.x))
        .y((p) => this.yScale(p.y))
        .addAll(points);
    } else {
      this.xScale.domain([-1, 1]).range([40, w - 40]);
      this.yScale.domain([-1, 1]).range([h - 40, 40]);
    }
    this.draw();
  }

  private draw() {
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    const { points, activeIds, selectedId, topicColors } = this.data;
    const t = this.transform;
    const effectiveActive = this.lassoSelectedIds ?? activeIds;

    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.save();
    ctx.scale(DPR, DPR);

    let selectedPt: ScholarProjectionPoint | null = null;

    const drawPt = (pt: ScholarProjectionPoint, r: number) => {
      ctx.fillStyle = topicColors.get(pt.topicId) ?? "#bfc9c0";
      ctx.beginPath();
      ctx.arc(t.applyX(this.xScale(pt.x)), t.applyY(this.yScale(pt.y)), r, 0, Math.PI * 2);
      ctx.fill();
    };

    // 背景点（未命中筛选）
    if (effectiveActive) {
      ctx.globalAlpha = 0.12;
      for (const pt of points) {
        if (pt.id === selectedId) selectedPt = pt;
        if (!effectiveActive.has(pt.id)) drawPt(pt, 3);
      }
    }

    // 激活点/正常点
    ctx.globalAlpha = 1;
    for (const pt of points) {
      if (!effectiveActive || effectiveActive.has(pt.id)) {
        if (pt.id === selectedId) selectedPt = pt;
        if (pt !== this.hoveredPt && pt !== selectedPt) drawPt(pt, 3);
      }
    }

    // 悬浮高亮点
    if (this.hoveredPt) {
      const cx = t.applyX(this.xScale(this.hoveredPt.x));
      const cy = t.applyY(this.yScale(this.hoveredPt.y));
      ctx.fillStyle = topicColors.get(this.hoveredPt.topicId) ?? "#bfc9c0";
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // 选中点（绿色外环）
    if (selectedPt) {
      const cx = t.applyX(this.xScale(selectedPt.x));
      const cy = t.applyY(this.yScale(selectedPt.y));
      ctx.fillStyle = topicColors.get(selectedPt.topicId) ?? "#22c55e";
      ctx.strokeStyle = "#22c55e";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();

    // 绘制套索轨迹
    const drawLassoPath = (path: [number, number][], frozen: boolean) => {
      if (path.length < 2) return;
      ctx.save();
      ctx.strokeStyle = "#005235";
      ctx.lineWidth = (frozen ? 1.5 : 2) * DPR;
      ctx.setLineDash(frozen ? [] : [6 * DPR, 4 * DPR]);
      ctx.fillStyle = frozen ? "rgba(0,82,53,0.05)" : "rgba(0,82,53,0.08)";
      ctx.beginPath();
      const first = path[0];
      if (!first) return;
      ctx.moveTo(t.applyX(first[0]) * DPR, t.applyY(first[1]) * DPR);
      for (let i = 1; i < path.length; i++) {
        const pt = path[i];
        if (!pt) continue;
        ctx.lineTo(t.applyX(pt[0]) * DPR, t.applyY(pt[1]) * DPR);
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
      for (const pt of this.data.points) {
        const px = this.xScale(pt.x);
        const py = this.yScale(pt.y);
        let inside = false;
        // 射线法判断点是否在多边形内
        for (let i = 0, j = this.lassoPath.length - 1; i < this.lassoPath.length; j = i++) {
          const pi = this.lassoPath[i];
          const pj = this.lassoPath[j];
          if (!pi || !pj) continue;
          const [xi, yi] = pi;
          const [xj, yj] = pj;
          if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
            inside = !inside;
          }
        }
        if (inside) selected.add(pt.id);
      }
      this.frozenLassoPath = [...this.lassoPath];
      this.lassoSelectedIds = selected;
      this.onLassoSelect(selected);
    }
    this.lassoPath = [];
    this.draw();
  }

  private onMouseDown = (e: MouseEvent) => {
    if (this.mode !== "lasso") return;
    const rect = this.canvas.getBoundingClientRect();
    this.isLassoing = true;
    this.frozenLassoPath = [];
    this.lassoSelectedIds = null;
    this.lassoPath = [
      [this.transform.invertX(e.clientX - rect.left), this.transform.invertY(e.clientY - rect.top)],
    ];
  };

  private onMouseUp = () => this.mode === "lasso" && this.commitLasso();

  private onMouseLeave = () => {
    if (this.mode === "lasso") this.commitLasso();
    this.hoveredPt = null;
    this.tooltip.style.display = "none";
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

    if (this.mode === "zoom") {
      const pt =
        this.qt.find(
          this.transform.invertX(mx),
          this.transform.invertY(my),
          HIT_RADIUS / (this.transform.k || 1),
        ) ?? null;
      if (pt !== this.hoveredPt) {
        this.hoveredPt = pt;
        if (pt) {
          this.tooltip.style.display = "block";
          this.tooltip.style.left = `${mx + 12}px`;
          this.tooltip.style.top = `${my - 8}px`;
          this.tooltip.textContent = pt.title || pt.id;
        } else {
          this.tooltip.style.display = "none";
        }
        this.draw();
      }
    }
  };

  private onMouseClick = (e: MouseEvent) => {
    if (this.mode !== "zoom") return;
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
  resetZoom: () => void;
  resetMode: () => void;
}

interface ScatterPlotProps {
  points: ScholarProjectionPoint[];
  activeIds: Set<string> | null;
  selectedId: string | null;
  topicColors: TopicColorMap;
  onPointClick: (id: string) => void;
  onLassoSelect?: (ids: Set<string>) => void;
  onReset?: () => void;
}

export const ScatterPlot = forwardRef<ScatterPlotRef, ScatterPlotProps>(
  ({ points, activeIds, selectedId, topicColors, onPointClick, onLassoSelect, onReset }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const controllerRef = useRef<ScatterPlotController | null>(null);
    const [scatterMode, setScatterMode] = useState<ScatterMode>("none");

    const callbacks = useRef({ onPointClick, onLassoSelect });
    callbacks.current = { onPointClick, onLassoSelect };

    useImperativeHandle(
      ref,
      () => ({
        resetZoom: () => controllerRef.current?.resetZoom(),
        resetMode: () => setScatterMode("none"),
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
      controllerRef.current?.setMode(scatterMode);
    }, [scatterMode]);

    useEffect(() => {
      controllerRef.current?.update({ points, activeIds, selectedId, topicColors });
    }, [points, activeIds, selectedId, topicColors]);

    const toggleMode = (m: ScatterMode) => setScatterMode((prev) => (prev === m ? "none" : m));

    return (
      <div className="w-full h-full relative">
        <div ref={containerRef} className="w-full h-full" />
        <div className="absolute top-2 right-2 flex items-center gap-0.5 p-0.5">
          <button
            type="button"
            onClick={() => toggleMode("zoom")}
            className={`p-1.5 rounded-md transition-colors ${scatterMode === "zoom" ? "bg-primary/15 text-primary" : "text-on-surface-variant hover:bg-surface-container-high"}`}
            title="缩放/点选"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => toggleMode("lasso")}
            className={`p-1.5 rounded-md transition-colors ${scatterMode === "lasso" ? "bg-primary/15 text-primary" : "text-on-surface-variant hover:bg-surface-container-high"}`}
            title="套索选择"
          >
            <Lasso className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              setScatterMode("none");
              controllerRef.current?.resetZoom();
              onReset?.();
            }}
            className="p-1.5 rounded-md text-on-surface-variant hover:bg-surface-container-high transition-colors"
            title="重置"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  },
);
