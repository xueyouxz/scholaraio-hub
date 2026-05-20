function SkeletonBar({ w, h = "h-3" }: { w: string; h?: string }) {
  return <div className={`skeleton-shimmer rounded ${h} ${w}`} />;
}

function SkeletonCard() {
  return (
    <article className="bg-surface-container-lowest rounded-xl p-6 border border-outline-variant/10">
      <SkeletonBar w="w-2/3" h="h-5" />
      <div className="mt-2 mb-5">
        <SkeletonBar w="w-full" h="h-6" />
        <div className="mt-1.5">
          <SkeletonBar w="w-4/5" h="h-6" />
        </div>
      </div>
      <SkeletonBar w="w-1/3" h="h-3" />
      <div className="mt-4 space-y-2">
        <SkeletonBar w="w-full" />
        <SkeletonBar w="w-11/12" />
        <SkeletonBar w="w-4/5" />
      </div>
    </article>
  );
}

export function SearchSkeleton() {
  return (
    <div className="flex flex-col gap-5">
      {[0, 1, 2].map((i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}
