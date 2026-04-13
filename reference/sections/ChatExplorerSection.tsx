import { BookOpen } from "lucide-react";
import type React from "react";
import SectionLabel from "../components/SectionLabel";
import { explorerKeywords } from "../mock/chat";
import { papers } from "../mock/entities";

const ChatExplorerSection: React.FC = () => (
  <aside className="hidden lg:flex w-80 bg-surface-container-lowest border-l border-outline-variant/10 flex-col p-6 overflow-y-auto no-scrollbar">
    <h2 className="font-serif font-bold text-lg mb-6">Explorer</h2>
    <div className="space-y-8">
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-primary" />
          <SectionLabel label="Top Citations" accent="primary" />
        </div>
        <div className="bg-surface p-4 rounded-xl space-y-3">
          {papers.slice(0, 3).map((paper, index) => (
            <div
              key={paper.id}
              className={`relative pl-4 ${index === 0 ? "border-l-2 border-primary/30" : "border-l-2 border-secondary/30"}`}
            >
              <p className="text-[10px] font-mono text-primary/80 mb-1">[{index + 1}]</p>
              <p className="text-xs font-semibold leading-snug line-clamp-2">{paper.title}</p>
              <p className="text-[10px] text-on-surface-variant mt-1">
                {paper.authors} ({paper.year})
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-primary" />
          <SectionLabel label="Selected Reference" accent="primary" />
        </div>
        <div className="rounded-xl border border-outline-variant/20 bg-surface p-4 space-y-3">
          <p className="text-xs font-semibold leading-snug">{papers[0].title}</p>
          <p className="text-[11px] text-on-surface-variant leading-relaxed">{papers[0].authors}</p>
          <p className="text-[10px] text-on-surface-variant">
            {papers[0].source} · {papers[0].year}
          </p>
          <button className="rounded-lg px-3 py-2 bg-primary/10 text-primary text-xs font-semibold">
            进入阅读器
          </button>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-primary" />
          <SectionLabel label="Keywords" accent="primary" />
        </div>
        <div className="rounded-xl bg-surface p-4 flex flex-wrap gap-2">
          {explorerKeywords.map((keyword) => (
            <span
              key={keyword}
              className="rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-mono uppercase text-primary"
            >
              {keyword}
            </span>
          ))}
        </div>
      </div>
    </div>
  </aside>
);

export default ChatExplorerSection;
