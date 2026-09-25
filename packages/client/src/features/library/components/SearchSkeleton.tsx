import type { ViewMode } from "./PaperVirtualList";

function Shimmer({ className }: { className: string }) {
  return <div className={`skeleton-shimmer rounded ${className}`} />;
}

function GridSkeletonCard() {
  return (
    <div className="bg-surface-container-low rounded-xl border border-outline-variant/20 overflow-hidden">
      <div className="px-3.5 py-3 flex flex-col gap-2">
        <Shimmer className="h-4 w-full" />
        <Shimmer className="h-4 w-4/5" />
        <Shimmer className="h-3 w-1/2 mt-1" />
        <Shimmer className="h-2.5 w-1/3" />
      </div>
      <Shimmer className="h-28 w-full rounded-none" />
    </div>
  );
}

function ListSkeletonRow() {
  return (
    <div
      className="bg-surface-container-low rounded-xl border border-transparent overflow-hidden flex items-stretch"
      style={{ height: 152 }}
    >
      <Shimmer className="w-36 h-full shrink-0 rounded-none" />
      <div className="flex-1 px-4 py-3 flex flex-col justify-between">
        <div className="flex flex-col gap-2">
          <Shimmer className="h-4 w-full" />
          <Shimmer className="h-4 w-3/4" />
          <Shimmer className="h-3 w-1/2 mt-1" />
        </div>
        <div className="flex gap-1.5">
          <Shimmer className="h-4 w-10 rounded-full" />
          <Shimmer className="h-4 w-10 rounded-full" />
        </div>
      </div>
    </div>
  );
}

interface Props {
  view?: ViewMode;
}

export function SearchSkeleton({ view = "grid" }: Props) {
  if (view === "list") {
    return (
      <div className="flex flex-col gap-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <ListSkeletonRow key={i} />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <GridSkeletonCard key={i} />
      ))}
    </div>
  );
}
