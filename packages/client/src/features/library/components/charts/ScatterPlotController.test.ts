import { afterEach, describe, expect, it, vi } from "vitest";
import type { ScholarProjectionPoint } from "../../../../core/api";
import { ScatterPlotController } from "./ScatterPlotController";

function installCanvasContext(): void {
  const context = {
    arc: vi.fn(),
    beginPath: vi.fn(),
    clearRect: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    fillText: vi.fn(),
    lineTo: vi.fn(),
    moveTo: vi.fn(),
    restore: vi.fn(),
    save: vi.fn(),
    scale: vi.fn(),
    setLineDash: vi.fn(),
    stroke: vi.fn(),
  } as unknown as CanvasRenderingContext2D;

  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context);
}

function rect(width: number, height: number): DOMRect {
  return {
    bottom: height,
    height,
    left: 0,
    right: width,
    top: 0,
    width,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  };
}

function createPoint(id: string, x: number, y: number): ScholarProjectionPoint {
  return {
    id,
    x,
    y,
    topicId: 1,
    year: 2024,
    title: id,
  };
}

describe("ScatterPlotController", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps point hit testing aligned after resize", () => {
    installCanvasContext();
    let resizeCallback: ResizeObserverCallback | null = null;

    class FakeResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback;
      }

      observe = vi.fn();
      disconnect = vi.fn();
    }

    vi.stubGlobal("ResizeObserver", FakeResizeObserver);

    const container = document.createElement("div");
    container.getBoundingClientRect = () => rect(200, 200);
    document.body.appendChild(container);

    const onPointClick = vi.fn();
    const controller = new ScatterPlotController(container, onPointClick);
    const points = [createPoint("paper-a", 0, 0), createPoint("paper-b", 10, 10)];

    controller.update({
      points,
      activeIds: null,
      selectedId: null,
      topicColors: new Map([[1, "#005235"]]),
    });
    controller.setMode("zoom");

    resizeCallback?.(
      [{ contentRect: { width: 600, height: 600 } } as ResizeObserverEntry],
      {} as ResizeObserver,
    );

    const canvas = container.querySelector("canvas");
    if (!canvas) throw new Error("Expected scatter plot canvas");
    canvas.getBoundingClientRect = () => rect(600, 600);

    canvas.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        clientX: 64,
        clientY: 536,
      }),
    );

    expect(onPointClick).toHaveBeenCalledWith("paper-a");
  });
});
