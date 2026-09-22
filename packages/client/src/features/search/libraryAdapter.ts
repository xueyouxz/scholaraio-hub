import type { LibraryPaper } from "@scholaraio-hub/shared";
import { requestJson } from "../../core/http";
import { libraryApi } from "../../core/library";
import type { ScholarPaper } from "../../core/scholarTypes";
import { toLibraryPaperRef } from "../library/paperUtils";

function paperForSearch(paper: LibraryPaper): ScholarPaper {
  return {
    ...toLibraryPaperRef(paper),
    dirName: paper.id,
    citations: String(
      paper.citationCount ?? Math.max(0, ...Object.values(paper.citationCounts ?? {})),
    ),
  };
}

/** Retain the original search components; adapt only their data boundary. */
export const searchLibrary = {
  async getPapers(params: { sort: string; projectId?: string }, options: { signal?: AbortSignal }) {
    const [data, project] = await Promise.all([
      libraryApi.papers(options.signal),
      params.projectId ? libraryApi.project(params.projectId, options.signal) : undefined,
    ]);
    const ids = project ? new Set(project.paperIds) : null;
    const papers = data.papers.filter((p) => !ids || ids.has(p.id)).map(paperForSearch);
    papers.sort((a, b) =>
      params.sort === "title_asc"
        ? a.title.localeCompare(b.title)
        : params.sort === "citations_desc"
          ? Number(b.citations) - Number(a.citations)
          : b.year - a.year,
    );
    return { papers };
  },
  async search(
    body: { query: string; mode: string; limit: number; projectId?: string },
    options: { signal?: AbortSignal },
  ) {
    const params = new URLSearchParams({
      q: body.query,
      mode: body.mode,
      limit: String(body.limit),
    });
    if (body.projectId) params.set("projectId", body.projectId);
    const data = await requestJson<{ results: { paper: LibraryPaper }[]; notice?: string }>(
      `/api/library/search?${params}`,
      options,
    );
    return {
      results: data.results.map((result) => paperForSearch(result.paper)),
      notice: data.notice,
    };
  },
  async getWorkspaces(options: { signal?: AbortSignal }) {
    return { workspaces: (await libraryApi.projects(options.signal)).projects };
  },
  createWorkspace: libraryApi.createProject,
  async batchAddPapersToWorkspace(id: string, ids: string[]) {
    const project = await libraryApi.project(id);
    await libraryApi.projectPapers(id, ids, "add");
    const existing = new Set(project.paperIds);
    return {
      added: ids.filter((id) => !existing.has(id)),
      skipped: ids.filter((id) => existing.has(id)).map((id) => ({ id })),
      failed: [] as { id: string; reason: string }[],
    };
  },
};
