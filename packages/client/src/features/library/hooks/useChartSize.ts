import { useEffect, useRef, useState } from "react";

export function useChartSize(defaultWidth = 400, defaultHeight = 200) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: defaultWidth, height: defaultHeight });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) {
        setSize({ width: Math.floor(width), height: Math.floor(height) });
      }
    });

    observer.observe(el);
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setSize({ width: Math.floor(rect.width), height: Math.floor(rect.height) });
    }

    return () => observer.disconnect();
  }, []);

  return { ref, ...size };
}
