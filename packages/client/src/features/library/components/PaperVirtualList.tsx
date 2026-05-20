import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef } from "react";
import type { PaperReference } from "../types";
import { PaperListRow } from "./PaperListRow";

const ROW_HEIGHT = 152;
const ROW_GAP = 8;

interface Props {
  papers: PaperReference[];
  selectedId?: string | null;
  onSelect: (paper: PaperReference) => void;
}

export function PaperVirtualList({ papers, selectedId, onSelect }: Props) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: papers.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT + ROW_GAP,
    overscan: 6,
  });

  const items = virtualizer.getVirtualItems();

  return (
    <div ref={parentRef} className="overflow-y-auto no-scrollbar" style={{ height: "100%" }}>
      <div
        style={{
          height: virtualizer.getTotalSize(),
          width: "100%",
          position: "relative",
        }}
      >
        {items.map((vItem) => {
          const paper = papers[vItem.index];
          if (!paper) return null;
          return (
            <div
              key={vItem.key}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${vItem.start}px)`,
                paddingBottom: ROW_GAP,
              }}
            >
              <PaperListRow
                paper={paper}
                isSelected={selectedId === paper.id}
                onClick={() => onSelect(paper)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
