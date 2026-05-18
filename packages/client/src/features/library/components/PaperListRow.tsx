import type { PaperReference } from "../types";

interface Props {
  paper: PaperReference;
  isSelected?: boolean;
  onClick?: () => void;
}

export function PaperListRow({ paper, isSelected, onClick }: Props) {
  const dotColor =
    paper.status === "ingested"
      ? "bg-primary shadow-[0_0_8px_rgba(26,107,74,0.4)]"
      : paper.status === "pending"
        ? "bg-tertiary"
        : paper.status === "indexing"
          ? "bg-secondary"
          : "bg-error";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left h-[72px] flex items-center px-6 transition-colors rounded-xl group cursor-pointer border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
        isSelected
          ? "bg-surface-container-high border-outline-variant/20 ring-1 ring-primary/20"
          : "bg-surface-container-low border-transparent hover:bg-surface-container-high"
      }`}
    >
      <div className={`w-2 h-2 rounded-full mr-6 shrink-0 ${dotColor}`} />
      <div className="flex-1 min-w-0">
        <h3 className="font-serif text-base font-semibold text-on-surface truncate pr-4">
          {paper.title}
        </h3>
        <p className="text-xs font-sans text-on-surface-variant truncate mt-0.5">
          {paper.authors} · {paper.source} · {paper.date ?? paper.year}
        </p>
      </div>
    </button>
  );
}
