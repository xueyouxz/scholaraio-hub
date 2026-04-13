import type React from "react";
import FilterCheckboxRow from "../components/FilterCheckboxRow";
import SectionLabel from "../components/SectionLabel";
import { libraryFilterTags } from "../mock/library";

const LibraryFilterSheetSection: React.FC = () => (
  <div className="fixed inset-0 z-[60] flex flex-col items-center">
    <div className="absolute inset-0 z-0 bg-on-surface/20 backdrop-blur-sm" />
    <div className="relative z-10 w-full max-w-4xl bg-surface-container-highest rounded-t-[2rem] shadow-2xl border-t border-outline-variant/20 mt-auto">
      <div className="h-16 flex items-center justify-center group">
        <div className="w-12 h-1.5 bg-outline-variant rounded-full group-hover:bg-primary transition-colors" />
      </div>
      <div className="px-10 pb-12">
        <div className="flex justify-between items-center mb-8">
          <h2 className="font-serif text-2xl font-bold">Refine Library</h2>
          <button className="text-sm font-mono font-bold text-primary hover:underline">
            CLEAR ALL
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
          <div>
            <SectionLabel label="Document Status" />
            <div className="space-y-3 mt-4">
              <FilterCheckboxRow label="Ingested Only" checked />
              <FilterCheckboxRow label="Missing PDF" />
              <FilterCheckboxRow label="Requires Indexing" checked />
            </div>
          </div>
          <div>
            <SectionLabel label="Publication Year" />
            <div className="space-y-4 mt-4">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="bg-surface-container px-2 py-1 rounded">2016</span>
                <div className="flex-1 h-px bg-outline-variant mx-3" />
                <span className="bg-primary text-on-primary px-2 py-1 rounded">2026</span>
              </div>
              <div className="space-y-3">
                <div className="w-full h-1.5 bg-outline-variant rounded-lg">
                  <div className="h-full w-2/3 bg-primary rounded-lg" />
                </div>
                <div className="w-full h-1.5 bg-outline-variant rounded-lg">
                  <div className="h-full w-5/6 bg-primary rounded-lg" />
                </div>
              </div>
            </div>
          </div>
          <div>
            <SectionLabel label="Source Type" />
            <div className="flex flex-wrap gap-2 mt-4">
              {libraryFilterTags.map((tag, index) => (
                <span
                  key={tag}
                  className={`px-3 py-1.5 text-xs font-medium rounded-full border ${
                    index < 2
                      ? "bg-primary text-on-primary border-primary"
                      : "bg-surface-container-high text-on-surface-variant border-outline-variant/30"
                  }`}
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-12 flex justify-end gap-4">
          <button className="px-8 py-3 rounded-full font-bold text-sm text-on-surface-variant hover:bg-surface-container-low">
            Cancel
          </button>
          <button className="px-10 py-3 rounded-full font-bold text-sm text-on-primary signature-gradient shadow-lg">
            Apply 4 Filters
          </button>
        </div>
      </div>
    </div>
  </div>
);

export default LibraryFilterSheetSection;
