import type {
  ProviderGroupFilter,
  ScholarPaperContentParams,
  ScholarPaperListParams,
  ScholarSearchBody,
} from "./api";

export const queryKeys = {
  projects: () => ["projects"] as const,
  projectSessions: (projectId: string, provider?: ProviderGroupFilter | null) =>
    ["projects", projectId, "sessions", provider ?? "all"] as const,
  projectSkills: (projectId: string, provider?: string | null) =>
    ["projects", projectId, "skills", provider ?? "default"] as const,
  processes: () => ["processes"] as const,
  providers: () => ["providers"] as const,
  providerUsageLimits: () => ["providers", "usage-limits"] as const,
  settings: () => ["settings"] as const,
  version: () => ["version"] as const,
  scholaraioSkills: () => ["scholaraio-skills"] as const,
  scholaraioSkill: (name: string) => ["scholaraio-skills", name] as const,
  scholar: {
    all: () => ["scholar"] as const,
    papers: (params: ScholarPaperListParams = {}) => ["scholar", "papers", params] as const,
    paper: (id: string) => ["scholar", "paper", id] as const,
    paperImages: (id: string) => ["scholar", "paper", id, "images"] as const,
    paperContent: (id: string, params: ScholarPaperContentParams) =>
      ["scholar", "paper", id, "content", params] as const,
    stats: () => ["scholar", "stats"] as const,
    // `limit` is omitted from the cache key: changing page size should not
    // invalidate an existing result. Mode/year/journal/paper_type stay in the key.
    search: (body: ScholarSearchBody) =>
      [
        "scholar",
        "search",
        {
          query: body.query,
          mode: body.mode,
          year: body.year,
          journal: body.journal,
          paper_type: body.paper_type,
        },
      ] as const,
    workspaces: () => ["scholar", "workspaces"] as const,
    workspace: (name: string) => ["scholar", "workspace", name] as const,
    config: () => ["scholar", "config"] as const,
    topics: () => ["scholar", "analytics", "topics"] as const,
    topicSimilarity: (params: { top_n?: number } = {}) =>
      ["scholar", "analytics", "topic-similarity", params] as const,
    projection: () => ["scholar", "analytics", "projection"] as const,
  },
};
