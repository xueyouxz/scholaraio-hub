import { ArrowLeft, BookOpen, Info, Maximize2, Minimize2, Share2, Sparkles } from "lucide-react";
import type React from "react";
import ReaderLayerTab from "../components/ReaderLayerTab";
import { readerLayers, selectedReaderPaper } from "../mock/reader";

interface ReaderDocumentSectionProps {
  fullWidth?: boolean;
}

const ReaderDocumentSection: React.FC<ReaderDocumentSectionProps> = ({ fullWidth = false }) => (
  <section className={`flex flex-col bg-surface relative ${fullWidth ? "w-full" : "w-[60%]"}`}>
    <div className="h-16 flex items-center justify-between px-8 bg-surface-container-low border-b border-outline-variant/10 shrink-0 z-30">
      <div className="flex items-center gap-6">
        <button className="p-2 hover:bg-surface-container rounded-full text-on-surface-variant transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-1 bg-surface-container p-1 rounded-xl">
          {readerLayers.map((layer) => (
            <ReaderLayerTab key={layer.label} label={layer.label} active={layer.active} />
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 px-3 py-1.5 bg-secondary-container/10 rounded-full border border-secondary-container/20">
          <Sparkles className="w-3.5 h-3.5 text-primary" />
          <span className="text-[10px] font-bold text-primary uppercase tracking-widest">
            Synthesis Active
          </span>
        </div>
        <div className="h-4 w-px bg-outline-variant/20 mx-1" />
        <button className="p-2 text-on-surface-variant hover:bg-surface-container rounded-lg transition-colors">
          {fullWidth ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
        </button>
        <button className="p-2 text-on-surface-variant hover:bg-surface-container rounded-lg transition-colors">
          <Share2 className="w-5 h-5" />
        </button>
      </div>
    </div>

    <div className="flex-1 p-6 bg-surface-dim overflow-hidden flex flex-col">
      <div className="flex-1 overflow-y-auto no-scrollbar bg-surface-container-lowest rounded-2xl border border-outline-variant/10 p-8">
        <div className="max-w-3xl">
          <h3 className="font-serif text-2xl font-bold text-on-surface mb-4">摘要</h3>
          <p className="text-base text-on-surface-variant leading-8">
            {selectedReaderPaper.abstract}
          </p>
          <div className="mt-8 p-6 rounded-2xl bg-surface-container-low border border-outline-variant/10">
            <h4 className="font-mono text-xs font-bold text-primary uppercase tracking-widest mb-3">
              Key Findings
            </h4>
            <ul className="space-y-2 text-sm text-on-surface-variant leading-7">
              <li>将阅读、检索和编排放在同一工作流内，能显著减少界面切换成本。</li>
              <li>阅读层级切换需要清晰的结构提示，而不是隐藏式功能。</li>
              <li>论文卡片、过滤器和工作区摘要都适合拆成纯展示组件。</li>
            </ul>
          </div>
        </div>
      </div>
    </div>

    <div className="fixed bottom-8 left-[30%] -translate-x-1/2 flex items-center gap-2 bg-on-surface text-surface px-6 py-3 rounded-full shadow-2xl z-50 border border-white/10 backdrop-blur-md">
      <BookOpen className="w-5 h-5 text-primary-container" />
      <span className="text-sm font-medium text-surface">Reader Mode Active</span>
      <div className="w-px h-4 bg-surface/30 mx-2" />
      <button className="text-xs font-mono opacity-80 flex items-center gap-2 text-surface">
        <Info className="w-3.5 h-3.5" />
        Layer: L2 精读
      </button>
    </div>
  </section>
);

export default ReaderDocumentSection;
