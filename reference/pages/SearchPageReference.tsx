import type React from "react";
import SearchFiltersSection from "../sections/SearchFiltersSection";
import SearchHeroSection from "../sections/SearchHeroSection";
import SearchResultsSection from "../sections/SearchResultsSection";

const SearchPageReference: React.FC = () => (
  <div className="flex-1 pt-8 px-6 pb-12 overflow-y-auto no-scrollbar">
    <SearchHeroSection />
    <div className="max-w-7xl mx-auto flex flex-col lg:flex-row gap-8 items-start">
      <SearchFiltersSection />
      <SearchResultsSection />
    </div>
  </div>
);

export default SearchPageReference;
