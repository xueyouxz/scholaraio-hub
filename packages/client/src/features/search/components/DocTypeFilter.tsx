export type DocTypeKey = "期刊论文" | "会议论文" | "预印本";

export interface DocTypeOption {
  key: DocTypeKey;
  label: string;
  count: number;
}

interface Props {
  options: DocTypeOption[];
  selected: Set<DocTypeKey>;
  onToggle: (key: DocTypeKey) => void;
}

export function DocTypeFilter({ options, selected, onToggle }: Props) {
  const maxCount = Math.max(...options.map((o) => o.count), 1);

  return (
    <div className="flex flex-col gap-1.5">
      {options.map((opt) => {
        const isSelected = selected.has(opt.key);
        const barPct = (opt.count / maxCount) * 100;

        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => onToggle(opt.key)}
            className={`flex flex-col gap-1.5 px-2.5 py-2 rounded-lg transition-colors text-left w-full group ${
              isSelected ? "bg-primary/8 hover:bg-primary/12" : "hover:bg-surface-container"
            }`}
          >
            <div className="flex items-center justify-between">
              <span
                className={`text-xs font-medium transition-colors ${
                  isSelected ? "text-primary" : "text-on-surface"
                }`}
              >
                {opt.label}
              </span>
              <span
                className={`text-[10px] font-mono font-bold transition-colors ${
                  isSelected ? "text-primary" : "text-on-surface-variant"
                }`}
              >
                {opt.count}
              </span>
            </div>
            <div className="h-1 rounded-full bg-outline-variant/20 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  isSelected ? "bg-primary" : "bg-outline-variant/60 group-hover:bg-outline-variant"
                }`}
                style={{ width: `${barPct}%` }}
              />
            </div>
          </button>
        );
      })}
    </div>
  );
}

export function normalizePaperType(paperType?: string): DocTypeKey | null {
  if (!paperType) return null;
  const t = paperType.toLowerCase();
  if (t.includes("journal") || t === "article") return "期刊论文";
  if (t.includes("proceedings") || t.includes("conference")) return "会议论文";
  if (t.includes("preprint") || t.includes("posted") || t.includes("arxiv")) return "预印本";
  return null;
}
