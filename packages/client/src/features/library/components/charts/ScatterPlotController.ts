import {
  type D3ZoomEvent,
  type Quadtree,
  type ScaleLinear,
  type ZoomBehavior,
  type ZoomTransform,
  quadtree,
  scaleLinear,
  select,
  zoom,
  zoomIdentity,
} from "d3";
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

export class ScatterPlotController {
  private canvas: HTMLCanvasElement;
  private tooltip: HTMLDivElement;
  private transform: ZoomTransform = zoomIdentity;
  private hovered: string | null = null;
  private mode: ScatterMode = "none";

  private xScale: ScaleLinear<number, number> = scaleLinear().domain([-1, 1]).range([40, 560]);
  private yScale: ScaleLinear<number, number> = scaleLinear().domain([-1, 1]).range([360, 40]);
  private qt: Quadtree<ScholarProjectionPoint> = quadtree<ScholarProjectionPoint>()
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
  private onLassoSelect?: (ids: Set<string>) => void;

  private resizeObserver: ResizeObserver;
  private onPointClick: (id: string) => void;
  private zoomBehavior: ZoomBehavior<HTMLCanvasElement, unknown>;

  constructor(container: HTMLElement, onPointClick: (id: string) => void) {
    this.onPointClick = onPointClick;

    this.canvas = document.createElement("canvas");
    this.canvas.style.cssText = "display:block;cursor:default;width:100%;height:100%";
    container.appendChild(this.canvas);

    this.tooltip = document.createElement("div");
    this.tooltip.style.cssText =
      "pointer-events:none;position:absolute;display:none;z-index:10;background:var(--color-surface-container-high,#1e1e1e);border:1px solid rgba(0,0,0,0.12);border-radius:8px;padding:2px 8px;font-size:11px;max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
    container.style.position = "relative";
    container.appendChild(this.tooltip);

    this.zoomBehavior = zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.3, 20])
      .on("zoom", (event: D3ZoomEvent<HTMLCanvasElement, unknown>) => {
        this.transform = event.transform;
        this.draw();
      });

    // Pointer events
    this.canvas.addEventListener("mousemove", this.onMouseMove);
    this.canvas.addEventListener("mousedown", this.onMouseDown);
    this.canvas.addEventListener("mouseup", this.onMouseUp);
    this.canvas.addEventListener("click", this.onMouseClick);
    this.canvas.addEventListener("mouseleave", this.onMouseLeave);

    this.resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) this.resize(Math.floor(width), Math.floor(height));
    });
    this.resizeObserver.observe(container);

    const rect = container.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0)
      this.resize(Math.floor(rect.width), Math.floor(rect.height));
  }

  resetZoom(): void {
    select(this.canvas).transition().duration(250).call(this.zoomBehavior.transform, zoomIdentity);
  }

  setMode(mode: ScatterMode): void {
    this.mode = mode;
    this.lassoPath = [];
    this.isLassoing = false;
    this.hovered = null;
    this.tooltip.style.display = "none";
    // Clear frozen selection when leaving lasso context entirely
    if (mode === "none") {
      this.frozenLassoPath = [];
      this.lassoSelectedIds = null;
    }

    if (mode === "zoom") {
      select(this.canvas).call(this.zoomBehavior);
      this.canvas.style.cursor = "crosshair";
    } else {
      select(this.canvas).on(".zoom", null);
      this.canvas.style.cursor = mode === "lasso" ? "crosshair" : "default";
    }

    this.draw();
  }

  setOnLassoSelect(cb: ((ids: Set<string>) => void) | undefined): void {
    this.onLassoSelect = cb;
  }

  update(data: ScatterPlotData): void {
    const pointsChanged = data.points !== this.pointsRef;
    this.data = data;

    if (pointsChanged) {
      this.pointsRef = data.points;
      if (data.points.length === 0) return;

      const w = this.canvas.width / DPR;
      const h = this.canvas.height / DPR;
      this.xScale = this.buildXScale(data.points, w);
      this.yScale = this.buildYScale(data.points, h);
      this.qt = this.buildQuadtree(data.points);
      this.transform = zoomIdentity;
    }

    this.draw();
  }

  destroy(): void {
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener("mousemove", this.onMouseMove);
    this.canvas.removeEventListener("mousedown", this.onMouseDown);
    this.canvas.removeEventListener("mouseup", this.onMouseUp);
    this.canvas.removeEventListener("click", this.onMouseClick);
    this.canvas.removeEventListener("mouseleave", this.onMouseLeave);
    select(this.canvas).on(".zoom", null);
    this.canvas.remove();
    this.tooltip.remove();
  }

  private resize(w: number, h: number): void {
    this.canvas.width = w * DPR;
    this.canvas.height = h * DPR;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.xScale = this.xScale.range([40, w - 40]);
    this.yScale = this.yScale.range([h - 40, 40]);
    if (this.data.points.length > 0) {
      this.qt = this.buildQuadtree(this.data.points);
    }
    this.draw();
  }

  private buildXScale(points: ScholarProjectionPoint[], w: number) {
    if (points.length === 0)
      return scaleLinear()
        .domain([-1, 1])
        .range([40, w - 40]);
    const xs = points.map((p) => p.x);
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    const pad = (xMax - xMin) * 0.05;
    return scaleLinear()
      .domain([xMin - pad, xMax + pad])
      .range([40, w - 40]);
  }

  private buildYScale(points: ScholarProjectionPoint[], h: number) {
    if (points.length === 0)
      return scaleLinear()
        .domain([-1, 1])
        .range([h - 40, 40]);
    const ys = points.map((p) => p.y);
    const yMin = Math.min(...ys);
    const yMax = Math.max(...ys);
    const pad = (yMax - yMin) * 0.05;
    return scaleLinear()
      .domain([yMin - pad, yMax + pad])
      .range([h - 40, 40]);
  }

  private buildQuadtree(points: ScholarProjectionPoint[]) {
    return quadtree<ScholarProjectionPoint>()
      .x((p) => this.xScale(p.x))
      .y((p) => this.yScale(p.y))
      .addAll(points);
  }

  private draw(): void {
    const canvas = this.canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { points, activeIds, selectedId, topicColors } = this.data;
    const t = this.transform;

    // Lasso selection takes precedence over external activeIds for dimming
    const effectiveActiveIds = this.lassoSelectedIds ?? activeIds;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(DPR, DPR);

    const radius = 3;

    // Draw dimmed (unselected) points
    if (effectiveActiveIds !== null) {
      ctx.globalAlpha = 0.12;
      for (const pt of points) {
        if (effectiveActiveIds.has(pt.id)) continue;
        const cx = t.applyX(this.xScale(pt.x));
        const cy = t.applyY(this.yScale(pt.y));
        ctx.fillStyle = topicColors.get(pt.topicId) ?? "#bfc9c0";
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.globalAlpha = 1;
    for (const pt of points) {
      if (effectiveActiveIds !== null && !effectiveActiveIds.has(pt.id)) continue;
      if (pt.id === selectedId || pt.id === this.hovered) continue;
      const cx = t.applyX(this.xScale(pt.x));
      const cy = t.applyY(this.yScale(pt.y));
      ctx.fillStyle = topicColors.get(pt.topicId) ?? "#bfc9c0";
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    if (this.hovered) {
      const hp = points.find((p) => p.id === this.hovered);
      if (hp) {
        const cx = t.applyX(this.xScale(hp.x));
        const cy = t.applyY(this.yScale(hp.y));
        ctx.fillStyle = topicColors.get(hp.topicId) ?? "#bfc9c0";
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(cx, cy, radius + 1, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }

    if (selectedId) {
      const sp = points.find((p) => p.id === selectedId);
      if (sp) {
        const cx = t.applyX(this.xScale(sp.x));
        const cy = t.applyY(this.yScale(sp.y));
        ctx.fillStyle = topicColors.get(sp.topicId) ?? "#22c55e";
        ctx.strokeStyle = "#22c55e";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, radius + 3, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();

    // Lasso overlays — drawn outside DPR-scaled ctx; coords multiplied by DPR manually
    const drawLassoPath = (path: [number, number][], frozen: boolean) => {
      if (path.length < 2) return;
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "#005235";
      ctx.lineWidth = (frozen ? 1.5 : 2) * DPR;
      ctx.setLineDash(frozen ? [] : [6 * DPR, 4 * DPR]);
      ctx.fillStyle = frozen ? "rgba(0,82,53,0.05)" : "rgba(0,82,53,0.08)";
      const [lx0, ly0] = path[0] as [number, number];
      ctx.beginPath();
      ctx.moveTo(t.applyX(lx0) * DPR, t.applyY(ly0) * DPR);
      for (const [lx, ly] of path.slice(1) as [number, number][]) {
        ctx.lineTo(t.applyX(lx) * DPR, t.applyY(ly) * DPR);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    };

    // In-progress lasso (dashed)
    if (this.lassoPath.length > 1) drawLassoPath(this.lassoPath, false);
    // Frozen / committed lasso (solid, shown after release)
    if (this.frozenLassoPath.length > 1) drawLassoPath(this.frozenLassoPath, true);
  }

  private findNearest(mx: number, my: number): ScholarProjectionPoint | null {
    const t = this.transform;
    const invX = t.invertX(mx);
    const invY = t.invertY(my);
    return this.qt.find(invX, invY, HIT_RADIUS / (t.k || 1)) ?? null;
  }

  private pointInPolygon(px: number, py: number, poly: [number, number][]): boolean {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i] as [number, number];
      const [xj, yj] = poly[j] as [number, number];
      if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  }

  private getPointsInLasso(): Set<string> {
    const selected = new Set<string>();
    for (const pt of this.data.points) {
      const ux = this.xScale(pt.x);
      const uy = this.yScale(pt.y);
      if (this.pointInPolygon(ux, uy, this.lassoPath)) selected.add(pt.id);
    }
    return selected;
  }

  private onMouseDown = (e: MouseEvent): void => {
    if (this.mode !== "lasso") return;
    const rect = this.canvas.getBoundingClientRect();
    this.isLassoing = true;
    // Clear previous frozen selection when starting a new lasso
    this.frozenLassoPath = [];
    this.lassoSelectedIds = null;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    this.lassoPath = [[this.transform.invertX(mx), this.transform.invertY(my)]];
  };

  private onMouseUp = (): void => {
    if (this.mode !== "lasso" || !this.isLassoing) return;
    this.isLassoing = false;
    if (this.lassoPath.length > 2) {
      const selected = this.getPointsInLasso();
      this.frozenLassoPath = [...this.lassoPath];
      this.lassoSelectedIds = selected;
      this.onLassoSelect?.(selected);
    }
    this.lassoPath = [];
    this.draw();
  };

  private onMouseMove = (e: MouseEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    if (this.mode === "lasso") {
      if (this.isLassoing) {
        this.lassoPath.push([this.transform.invertX(mx), this.transform.invertY(my)]);
        this.draw();
      }
      return;
    }

    if (this.mode !== "zoom") return;

    const pt = this.findNearest(mx, my);
    const prev = this.hovered;
    this.hovered = pt?.id ?? null;

    if (pt) {
      this.tooltip.style.display = "block";
      this.tooltip.style.left = `${mx + 12}px`;
      this.tooltip.style.top = `${my - 8}px`;
      this.tooltip.textContent = pt.title || pt.id;
    } else {
      this.tooltip.style.display = "none";
    }

    if (pt?.id !== prev) this.draw();
  };

  private onMouseClick = (e: MouseEvent): void => {
    if (this.mode !== "zoom") return;
    const rect = this.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const pt = this.findNearest(mx, my);
    if (pt) this.onPointClick(pt.id);
  };

  private onMouseLeave = (): void => {
    if (this.mode === "lasso" && this.isLassoing) {
      this.isLassoing = false;
      if (this.lassoPath.length > 2) {
        const selected = this.getPointsInLasso();
        this.frozenLassoPath = [...this.lassoPath];
        this.lassoSelectedIds = selected;
        this.onLassoSelect?.(selected);
      }
      this.lassoPath = [];
    }
    this.hovered = null;
    this.tooltip.style.display = "none";
    this.draw();
  };
}
