import type React from "react";
import FilterCheckboxRow from "../components/FilterCheckboxRow";
import SectionLabel from "../components/SectionLabel";
import { searchFilters } from "../mock/search";

const SearchFiltersSection: React.FC = () => (
  <aside className="w-full lg:w-[280px] bg-surface-container-low rounded-xl p-6 flex flex-col gap-8 shrink-0">
    <div>
      <SectionLabel label="Publication Year" accent="primary" />
      <div className="px-2 mt-4">
        <div className="h-1 w-full bg-outline-variant rounded-full relative mb-4">
          <div className="absolute h-1 bg-primary rounded-full left-[18%] right-[6%]" />
          <div className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white border-2 border-primary rounded-full left-[18%] -translate-x-1/2" />
          <div className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white border-2 border-primary rounded-full left-[94%] -translate-x-1/2" />
        </div>
        <div className="flex justify-between text-xs font-mono text-on-surface-variant">
          <span>2016</span>
          <span>2026</span>
        </div>
      </div>
    </div>

    {searchFilters.map((group) => (
      <div key={group.title}>
        <SectionLabel label={group.title} accent="primary" />
        <div className="flex flex-col gap-3 mt-4">
          {group.options.map((option) => (
            <FilterCheckboxRow key={option.label} label={option.label} checked={option.checked} />
          ))}
        </div>
      </div>
    ))}
  </aside>
);

export default SearchFiltersSection;
