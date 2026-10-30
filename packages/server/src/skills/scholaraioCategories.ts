import type { ScholaraioSkill, ScholaraioSkillCategory } from "@scholaraio-hub/shared";

const UNCATEGORIZED_ID = "__uncategorized__";

const SCHOLARAIO_CATEGORIES: Array<ScholaraioSkillCategory & { skills: string[] }> = [
  {
    id: "ingest",
    label: "采集入库",
    order: 1,
    skills: [
      "ingest",
      "ingest-link",
      "import",
      "arxiv",
      "patent-search",
      "patent-fetch",
      "webextract",
      "websearch",
    ],
  },
  {
    id: "maintenance",
    label: "知识库维护",
    order: 2,
    skills: ["enrich", "index", "audit", "scrub", "rename", "backup", "setup"],
  },
  {
    id: "discover",
    label: "检索浏览",
    order: 3,
    skills: [
      "search",
      "show",
      "graph",
      "citations",
      "topics",
      "explore",
      "workspace",
      "insights",
      "metrics",
    ],
  },
  {
    id: "reading",
    label: "阅读精读",
    order: 4,
    skills: ["paper-guided-reading"],
  },
  {
    id: "writing",
    label: "学术写作",
    order: 5,
    skills: [
      "academic-writing",
      "literature-review",
      "paper-writing",
      "research-gap",
      "review-response",
      "writing-polish",
      "translate",
      "citation-check",
      "poster",
      "technical-report",
      "publish",
    ],
  },
  {
    id: "documents",
    label: "文档产出",
    order: 6,
    skills: ["document", "draw", "export", "paper2any"],
  },
  {
    id: "scientific",
    label: "科学计算",
    order: 7,
    skills: [
      "scientific-runtime",
      "scientific-tool-onboarding",
      "bioinformatics",
      "gromacs",
      "lammps",
      "openfoam",
      "quantum-espresso",
    ],
  },
];

const UNCATEGORIZED: ScholaraioSkillCategory = {
  id: UNCATEGORIZED_ID,
  label: "未分类",
  order: 999,
};

export function getCategoryIdForSkill(skillName: string): string {
  for (const cat of SCHOLARAIO_CATEGORIES) {
    if (cat.skills.includes(skillName)) return cat.id;
  }
  return UNCATEGORIZED_ID;
}

/** Categories whose skills work on papers; a chat referring to papers offers them. */
const PAPER_CATEGORIES = new Set(["reading", "discover", "writing"]);

/** Skills that need a given number of papers; the rest of those categories take any. */
const PAPER_COUNTS: Record<string, NonNullable<ScholaraioSkill["papers"]>> = {
  "paper-guided-reading": "single",
  show: "single",
  "literature-review": "multi",
  "research-gap": "multi",
  "citation-check": "multi",
};

/** The papers a skill works on; undefined for a skill that takes none. */
export function getPapersForSkill(skillName: string): ScholaraioSkill["papers"] {
  if (!PAPER_CATEGORIES.has(getCategoryIdForSkill(skillName))) return undefined;
  return PAPER_COUNTS[skillName] ?? "any";
}

export function getCategoryList(): ScholaraioSkillCategory[] {
  return [
    ...SCHOLARAIO_CATEGORIES.map(({ id, label, order }) => ({ id, label, order })),
    UNCATEGORIZED,
  ];
}
