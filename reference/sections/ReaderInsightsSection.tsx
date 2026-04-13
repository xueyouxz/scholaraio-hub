import { Check, History, SlidersHorizontal, Sparkles } from "lucide-react";
import type React from "react";
import InsightPaperCard from "../components/InsightPaperCard";
import { readerInsights } from "../mock/reader";

const ReaderInsightsSection: React.FC = () => (
  <aside className="w-[40%] bg-surface-container-low border-l border-outline-variant/15 flex flex-col rounded-tl-[32px] overflow-hidden relative z-10 shadow-[-20px_0_40px_rgba(0,0,0,0.05)]">
    <div className="p-10 pb-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary-container/10 rounded-lg">
            <History className="w-5 h-5 text-primary" />
          </div>
          <h3 className="font-serif text-2xl font-bold text-on-surface">关联洞察</h3>
        </div>
        <span className="text-[10px] font-mono font-bold bg-primary-container text-on-primary-container px-3 py-1 rounded-full">
          CONTEXTUAL
        </span>
      </div>
      <p className="text-sm text-on-surface-variant font-sans leading-relaxed">
        将当前论文与既有文库和工作区脉络进行关联，形成后续重构的参考上下文。
      </p>
    </div>

    <div className="mx-10 mb-8 p-4 signature-gradient rounded-2xl flex items-center justify-between shadow-xl shadow-primary/10">
      <div className="flex items-center gap-3">
        <div className="w-6 h-6 rounded-lg bg-surface-container-lowest flex items-center justify-center shadow-inner">
          <Check className="w-4 h-4 text-primary" />
        </div>
        <span className="text-on-primary text-sm font-bold">2 Papers Selected</span>
      </div>
      <button className="bg-surface-container-lowest text-primary px-4 py-2 rounded-xl text-xs font-bold">
        Ingest to Atelier
      </button>
    </div>

    <div className="flex-1 px-10 pb-40 space-y-10 overflow-y-auto no-scrollbar">
      <div className="space-y-6">
        <div className="flex items-center gap-3 text-primary font-mono text-[10px] font-bold tracking-widest uppercase opacity-60">
          <SlidersHorizontal className="w-3.5 h-3.5" />
          Semantic Proximity
        </div>
        {readerInsights.map((item) => (
          <InsightPaperCard key={item.id} item={item} />
        ))}
      </div>
    </div>

    <div className="absolute bottom-0 w-full p-6 bg-gradient-to-t from-surface-container-low via-surface-container-low to-transparent pt-12">
      <div className="flex items-center justify-between p-5 bg-surface-container-lowest rounded-[24px] shadow-2xl border border-primary/5 group">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-primary/10 rounded-2xl">
            <Sparkles className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-bold text-on-surface uppercase tracking-tighter mb-0.5">
              Synthesis Insight
            </p>
            <p className="text-[11px] text-on-surface-variant leading-tight">
              Cross-referencing 2 sources on research UI architecture.
            </p>
          </div>
        </div>
        <div className="w-10 h-10 rounded-full flex items-center justify-center bg-surface-container text-primary">
          →
        </div>
      </div>
    </div>
  </aside>
);

export default ReaderInsightsSection;
