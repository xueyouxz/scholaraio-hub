import type React from "react";
import LibraryCollectionSection from "../sections/LibraryCollectionSection";
import LibraryFilterSheetSection from "../sections/LibraryFilterSheetSection";
import LibraryStatsSection from "../sections/LibraryStatsSection";
import LibraryToolbarSection from "../sections/LibraryToolbarSection";

const LibraryPageReference: React.FC = () => (
  <div className="flex-1 p-8 overflow-y-auto no-scrollbar">
    <LibraryStatsSection />
    <LibraryToolbarSection />
    <LibraryCollectionSection />
    <LibraryFilterSheetSection />
  </div>
);

export default LibraryPageReference;
