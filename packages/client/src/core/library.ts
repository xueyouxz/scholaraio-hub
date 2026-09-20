import type {
  ImportJob,
  LibraryPaper,
  LibraryPaperDetail,
  LibrarySearchResult,
  ReadingPosition,
  StoredSession,
} from "@scholaraio-hub/shared";
import { pathSegment, requestJson } from "./http";

export const libraryApi = {
  papers: (signal?: AbortSignal) =>
    requestJson<{ papers: LibraryPaper[] }>("/api/library/papers", { signal }),
  search: (query: string, signal?: AbortSignal) =>
    requestJson<{ results: LibrarySearchResult[] }>(
      `/api/library/search?q=${encodeURIComponent(query)}&limit=200`,
      { signal },
    ),
  detail: (id: string, signal?: AbortSignal) =>
    requestJson<LibraryPaperDetail>(`/api/library/papers/${pathSegment(id)}`, { signal }),
  jobs: (signal?: AbortSignal) =>
    requestJson<{ jobs: ImportJob[] }>("/api/library/imports", { signal }),
  upload: (files: File[]) => {
    const body = new FormData();
    for (const file of files) body.append("files", file);
    return requestJson<ImportJob>("/api/library/imports", { method: "POST", body });
  },
  retry: (id: string) =>
    requestJson<ImportJob>(`/api/library/imports/${pathSegment(id)}/retry`, { method: "POST" }),
  position: (id: string, signal?: AbortSignal) =>
    requestJson<ReadingPosition>(`/api/library/papers/${pathSegment(id)}/position`, { signal }),
  savePosition: (id: string, position: ReadingPosition) =>
    requestJson<ReadingPosition>(`/api/library/papers/${pathSegment(id)}/position`, {
      method: "PUT",
      body: JSON.stringify(position),
    }),
};
export const sessionApi = {
  list: (signal?: AbortSignal) =>
    requestJson<{ sessions: StoredSession[] }>("/api/sessions", { signal }),
  get: (id: string, signal?: AbortSignal) =>
    requestJson<StoredSession>(`/api/sessions/${pathSegment(id)}`, { signal }),
  create: (provider: "claude" | "codex", paperIds: string[] = [], model?: string) =>
    requestJson<StoredSession>("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ provider, paperIds, model }),
    }),
  stop: (id: string) => requestJson(`/api/sessions/${pathSegment(id)}/stop`, { method: "POST" }),
  input: (
    id: string,
    requestId: string,
    decision: "approve" | "deny",
    answers?: Record<string, string>,
  ) =>
    requestJson(`/api/sessions/${pathSegment(id)}/input`, {
      method: "POST",
      body: JSON.stringify({ requestId, decision, answers }),
    }),
};
