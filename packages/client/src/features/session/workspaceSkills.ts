import type { ScholaraioSkill } from "@scholaraio-hub/shared";

/**
 * Category ids (from server `scholaraioCategories.ts`) that describe
 * paper-reading / workspace-analysis skills. Skills outside this set
 * (ingest, maintenance, documents, scientific) are excluded from the
 * NewSessionPage chip pool.
 */
export const READING_CONTEXT_CATEGORY_IDS = new Set<string>(["reading", "discover", "writing"]);

type Cardinality = "single" | "multi" | "any";

/**
 * How many paper-ids each skill expects when invoked from a workspace's
 * NewSessionPage. Skills not listed default to "any" (work with 0+ papers,
 * just inserted as a bare slash command).
 *
 * - "single": one paper-id arg; chip disabled when 0 or ≥2 selected
 * - "multi": ≥2 paper-id args; chip disabled when 0 or 1 selected
 * - "any": any number works (typically 1+); chip disabled only when 0
 */
const SKILL_CARDINALITY: Record<string, Cardinality> = {
  // reading
  "paper-guided-reading": "single",
  // discover
  show: "single",
  citations: "any",
  graph: "any",
  "shared-refs": "multi",
  topics: "any",
  explore: "any",
  workspace: "any",
  insights: "any",
  metrics: "any",
  search: "any",
  // writing
  "literature-review": "multi",
  "research-gap": "multi",
  "academic-writing": "any",
  "paper-writing": "any",
  "review-response": "any",
  "writing-polish": "any",
  translate: "any",
  "citation-check": "multi",
  poster: "any",
  "technical-report": "any",
  publish: "any",
};

export function getSkillCardinality(skillName: string): Cardinality {
  return SKILL_CARDINALITY[skillName] ?? "any";
}

export function isSkillEnabledForSelection(skillName: string, selectedCount: number): boolean {
  if (selectedCount === 0) return false;
  const card = getSkillCardinality(skillName);
  if (card === "single") return selectedCount === 1;
  if (card === "multi") return selectedCount >= 2;
  return true;
}

export function describeCardinalityRequirement(skillName: string): string {
  const card = getSkillCardinality(skillName);
  if (card === "single") return "仅支持单篇文献";
  if (card === "multi") return "需要至少 2 篇文献";
  return "适用于任意数量的文献";
}

export function filterReadingContextSkills(skills: ScholaraioSkill[]): ScholaraioSkill[] {
  return skills.filter((s) => READING_CONTEXT_CATEGORY_IDS.has(s.category));
}

/** Build the message-input prefill for a skill chip click. */
export function buildSkillInvocation(skillName: string, paperIds: string[]): string {
  const card = getSkillCardinality(skillName);
  let ids = paperIds;
  if (card === "single") ids = paperIds.slice(0, 1);
  return ids.length > 0 ? `/${skillName} ${ids.join(" ")}` : `/${skillName}`;
}
