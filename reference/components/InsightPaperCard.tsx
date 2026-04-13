import { Check, ChevronRight, Quote, User } from "lucide-react";
import type React from "react";
import type { ReaderInsightReference } from "../types/ui";

interface InsightPaperCardProps {
  item: ReaderInsightReference;
}

const InsightPaperCard: React.FC<InsightPaperCardProps> = ({ item }) => (
  <article
    className={`group p-6 rounded-[24px] transition-all duration-300 cursor-default border ${
      item.selected
        ? "bg-surface-container-lowest border-primary/30 shadow-lg"
        : "bg-surface-container-highest border-transparent hover:border-outline-variant/20"
    }`}
  >
    <div className="flex items-start justify-between mb-4">
      <h4 className="font-serif text-lg font-bold text-on-surface leading-tight pr-6 group-hover:text-primary transition-colors">
        {item.title}
      </h4>
      <div
        className={`w-6 h-6 rounded-lg border-2 transition-all shrink-0 flex items-center justify-center ${
          item.selected ? "border-primary bg-primary shadow-md" : "border-outline-variant"
        }`}
      >
        {item.selected ? <Check className="w-4 h-4 text-white" /> : null}
      </div>
    </div>

    <div className="flex items-center gap-3 mb-4">
      <div className="flex items-center gap-1.5 px-2 py-1 bg-surface-container-low rounded-lg">
        <User className="w-3 h-3 text-primary" />
        <span className="text-[10px] font-mono font-bold text-on-surface-variant">
          {item.authors}
        </span>
      </div>
      <span className="text-[10px] font-mono text-on-surface-variant opacity-50">{item.year}</span>
    </div>

    <p className="text-xs text-on-surface-variant leading-relaxed line-clamp-3 italic font-serif mb-6 opacity-80">
      "{item.summary}"
    </p>

    <div className="flex items-center justify-between pt-4 border-t border-outline-variant/10">
      <div className="flex items-center gap-1.5 text-[10px] text-primary font-bold uppercase tracking-tighter">
        <Quote className="w-3.5 h-3.5" />
        {item.citations} Citations
      </div>
      <div className="text-[10px] font-bold text-on-surface-variant flex items-center gap-1">
        查看全文 <ChevronRight className="w-3 h-3" />
      </div>
    </div>
  </article>
);

export default InsightPaperCard;
