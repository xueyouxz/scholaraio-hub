import type React from "react";
import StatCard from "../components/StatCard";
import { libraryStats } from "../mock/library";

const LibraryStatsSection: React.FC = () => (
  <section className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-12">
    {libraryStats.map((stat) => (
      <StatCard key={stat.label} stat={stat} />
    ))}
  </section>
);

export default LibraryStatsSection;
