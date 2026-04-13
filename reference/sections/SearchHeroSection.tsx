import { Sparkles } from "lucide-react";
import type React from "react";
import SearchInput from "../components/SearchInput";
import { searchModes } from "../mock/search";

const SearchHeroSection: React.FC = () => (
  <header className="max-w-5xl mx-auto mb-12">
    <div className="flex flex-col items-center text-center mb-8">
      <h2 className="font-serif text-4xl font-bold text-on-surface mb-2">检索集体知识网络</h2>
      <p className="text-on-surface-variant max-w-xl font-sans">
        面向学术研究的语义检索、主题聚类与结构化综合界面。
      </p>
    </div>

    <div className="relative max-w-3xl mx-auto mb-6">
      <SearchInput value="学术助手界面的分层阅读与工作区组织方式" />
    </div>

    <div className="flex justify-center gap-3">
      {searchModes.map((mode) => (
        <div
          key={mode.label}
          className={`px-5 py-2 rounded-full font-sans text-sm flex items-center gap-2 ${
            mode.active
              ? "signature-gradient text-on-primary shadow-lg shadow-primary/20"
              : "border border-outline-variant text-on-surface-variant"
          }`}
        >
          {mode.highlight ? <Sparkles className="w-4 h-4" /> : null}
          <span>{mode.label}</span>
        </div>
      ))}
    </div>
  </header>
);

export default SearchHeroSection;
