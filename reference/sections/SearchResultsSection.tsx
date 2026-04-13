import { ChevronDown, LayoutGrid } from "lucide-react";
import type React from "react";
import SearchResultCard from "../components/SearchResultCard";
import { searchResults } from "../mock/search";

const SearchResultsSection: React.FC = () => (
  <section className="flex-grow">
    <div className="flex items-center justify-between h-12 mb-6 px-2 relative">
      <div className="text-sm text-on-surface-variant font-mono">
        <span className="font-bold text-primary">{searchResults.length}</span> results
      </div>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 text-sm text-on-surface-variant">
          <span>
            Sort by: <span className="font-bold text-on-surface">Year (Newest)</span>
          </span>
          <ChevronDown className="w-4 h-4" />
        </div>
        <button className="p-2 text-outline-variant hover:text-primary">
          <LayoutGrid className="w-5 h-5" />
        </button>
      </div>
      <div className="absolute right-2 top-10 z-20 bg-surface-container-high border border-outline-variant/20 rounded-xl p-2 w-56 shadow-xl">
        <div className="w-full text-left px-3 py-2 text-sm rounded-lg bg-primary/10 text-primary font-semibold">
          Year (Newest)
        </div>
        <div className="w-full text-left px-3 py-2 text-sm rounded-lg">Citations</div>
        <div className="w-full text-left px-3 py-2 text-sm rounded-lg">Title</div>
      </div>
    </div>

    <div className="grid grid-cols-1 gap-6">
      {searchResults.map((paper) => (
        <SearchResultCard key={paper.id} paper={paper} />
      ))}
    </div>
  </section>
);

export default SearchResultsSection;
