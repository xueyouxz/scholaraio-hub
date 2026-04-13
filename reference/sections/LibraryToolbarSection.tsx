import { ChevronDown, LayoutGrid, LayoutList, SortAsc } from "lucide-react";
import type React from "react";

const LibraryToolbarSection: React.FC = () => (
  <div className="flex items-center justify-between mb-6 relative">
    <div className="flex items-center gap-4">
      <div className="flex items-center gap-2 px-4 py-2 bg-surface-container-high rounded-full text-sm font-medium text-on-surface">
        Filters
      </div>
      <div className="flex items-center gap-2 px-4 py-2 bg-surface-container-high rounded-full text-sm font-medium text-primary">
        <SortAsc className="w-4 h-4" />
        Sort: Year (Newest)
        <ChevronDown className="w-4 h-4" />
      </div>
      <div className="h-4 w-px bg-outline-variant/30" />
      <p className="text-sm text-on-surface-variant font-sans">
        Showing <span className="font-bold text-on-surface">4</span> results
      </p>
    </div>
    <div className="flex gap-2">
      <button className="p-2 rounded-lg bg-primary/10 text-primary">
        <LayoutList className="w-5 h-5" />
      </button>
      <button className="p-2 rounded-lg text-on-surface-variant hover:bg-surface-container-high">
        <LayoutGrid className="w-5 h-5" />
      </button>
    </div>
    <div className="absolute top-12 left-0 z-20 w-64 bg-surface-container-high border border-outline-variant/20 rounded-xl p-2 shadow-xl">
      <div className="w-full text-left px-3 py-2 rounded-lg text-sm bg-primary/10 text-primary font-semibold">
        Year (Newest)
      </div>
      <div className="w-full text-left px-3 py-2 rounded-lg text-sm text-on-surface">
        Citations (High to Low)
      </div>
    </div>
  </div>
);

export default LibraryToolbarSection;
