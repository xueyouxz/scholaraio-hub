import type { PaperReference } from "../types";

interface Props {
  paper: PaperReference;
  isSelected?: boolean;
  onClick?: () => void;
}

const dotColor: Record<string, string> = {
  ingested: "bg-primary shadow-[0_0_8px_rgba(26,107,74,0.4)]",
  pending: "bg-tertiary",
  indexing: "bg-secondary",
};

export function PaperGridCard({ paper, isSelected, onClick }: Props) {
  const dot = dotColor[paper.status ?? ""] ?? "bg-error";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left p-5 transition-all rounded-xl cursor-pointer border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
        isSelected
          ? "bg-surface-container-high border-primary/30 ring-1 ring-primary/20 shadow-md"
          : "bg-surface-container-low border-outline-variant/10 hover:shadow-md"
      }`}
    >
      <div className="flex items-start gap-3 mb-3">
        <div className={`w-2 h-2 rounded-full shrink-0 mt-1.5 ${dot}`} />
        <h3 className="font-serif text-base font-semibold text-on-surface line-clamp-2">
          {paper.title}
        </h3>
      </div>
      <p className="text-xs text-on-surface-variant mb-1 line-clamp-1 pl-5">{paper.authors}</p>
      <p className="text-xs text-on-surface-variant pl-5">
        {paper.source} · {paper.date ?? paper.year}
      </p>
    </button>
  );
}
