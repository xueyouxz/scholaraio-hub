import type React from "react";
import PaperGridCard from "../components/PaperGridCard";
import PaperListRow from "../components/PaperListRow";
import { libraryYearGroups } from "../mock/library";

interface LibraryCollectionSectionProps {
  viewMode?: "list" | "grid";
}

const LibraryCollectionSection: React.FC<LibraryCollectionSectionProps> = ({
  viewMode = "list",
}) => (
  <div className="space-y-8">
    {libraryYearGroups.map((group) => (
      <section key={group.year}>
        <div className="flex items-center gap-4 mb-4">
          <h2 className="font-serif text-xl font-bold text-on-surface">{group.year}</h2>
          <span className="text-xs font-mono text-on-surface-variant bg-surface-container px-2 py-0.5 rounded">
            {group.papers.length} papers
          </span>
          <div className="flex-1 h-px bg-outline-variant/10" />
        </div>

        {viewMode === "list" ? (
          <div className="space-y-3">
            {group.papers.map((paper) => (
              <PaperListRow key={paper.id} paper={paper} />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {group.papers.map((paper) => (
              <PaperGridCard key={paper.id} paper={paper} />
            ))}
          </div>
        )}
      </section>
    ))}
  </div>
);

export default LibraryCollectionSection;
