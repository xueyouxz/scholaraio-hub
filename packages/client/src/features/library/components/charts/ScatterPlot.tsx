import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { ScholarProjectionPoint } from "../../../../core/api";
import type { TopicColorMap } from "../../types";
import { type ScatterMode, ScatterPlotController } from "./ScatterPlotController";

export interface ScatterPlotRef {
  resetZoom: () => void;
}

interface Props {
  points: ScholarProjectionPoint[];
  activeIds: Set<string> | null;
  selectedId: string | null;
  topicColors: TopicColorMap;
  mode: ScatterMode;
  onPointClick: (id: string) => void;
  onLassoSelect?: (ids: Set<string>) => void;
}

export const ScatterPlot = forwardRef<ScatterPlotRef, Props>(
  ({ points, activeIds, selectedId, topicColors, mode, onPointClick, onLassoSelect }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const controllerRef = useRef<ScatterPlotController | null>(null);

    useImperativeHandle(ref, () => ({
      resetZoom: () => controllerRef.current?.resetZoom(),
    }));

    // Keep callback refs current without triggering controller recreation
    const onPointClickRef = useRef(onPointClick);
    onPointClickRef.current = onPointClick;
    const onLassoSelectRef = useRef(onLassoSelect);
    onLassoSelectRef.current = onLassoSelect;

    // Create controller once — stable wrappers read from refs so callbacks never stale
    useEffect(() => {
      if (!containerRef.current) return;
      const ctrl = new ScatterPlotController(containerRef.current, (id) =>
        onPointClickRef.current(id),
      );
      ctrl.setOnLassoSelect((ids) => onLassoSelectRef.current?.(ids));
      controllerRef.current = ctrl;
      return () => {
        ctrl.destroy();
        controllerRef.current = null;
      };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
      controllerRef.current?.setMode(mode);
    }, [mode]);

    useEffect(() => {
      controllerRef.current?.update({
        points,
        activeIds,
        selectedId,
        topicColors,
      });
    }, [points, activeIds, selectedId, topicColors]);

    return <div ref={containerRef} className="w-full h-full" />;
  },
);
