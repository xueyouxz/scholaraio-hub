import { libraryApi } from "../../../../core/library";
import type { Staged } from "./sources";

/** Hand staged entries to the import queue, one job per source kind. */
export async function submitStaged(entries: Staged[]): Promise<{
  jobs: string[];
  skipped: { title: string; error: string }[];
}> {
  const files = entries.filter((entry) => entry.kind === "file").map((entry) => entry.file);
  const jobs: string[] = [];
  const skipped: { title: string; error: string }[] = [];
  if (files.length) jobs.push((await libraryApi.upload(files)).id);
  for (const entry of entries) {
    if (entry.kind === "locator") jobs.push((await libraryApi.fetchPaper(entry.name)).id);
    if (entry.kind === "references") {
      const job = await libraryApi.importReferences(entry.file);
      jobs.push(job.id);
      skipped.push(...job.skipped);
    }
  }
  return { jobs, skipped };
}
