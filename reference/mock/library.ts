import { libraryStats, papers } from "./entities";

export const libraryYearGroups = [
  { year: 2026, papers: papers.slice(0, 1) },
  { year: 2025, papers: papers.slice(1, 3) },
  { year: 2024, papers: papers.slice(3) },
];

export const libraryFilterTags = ["CHI", "UIST", "arXiv", "CSCW"];
export { libraryStats };
