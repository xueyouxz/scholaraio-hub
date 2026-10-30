import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { libraryApi } from "../../../../core/library";
import { errorMessage } from "../../../../shared/format";
import { uploadBatches } from "./localFiles";

/** Something chosen for import, not yet handed to the queue. */
export type Staged =
  | { kind: "file"; id: string; name: string; path: string; file: File }
  | {
      kind: "locator";
      id: string;
      name: string;
      locator: string;
      /** Authors, venue and year, when it came from a web search. */
      detail?: string;
    };

/** A staged entry on its way to the queue, before the queue has a job for it. */
export interface SendingRow {
  id: string;
  name: string;
  kind: Staged["kind"];
  state: "sending" | "failed";
  error?: string;
}

// Each fetch downloads before it answers; a few at a time keeps a long list moving.
const FETCH_CONCURRENCY = 3;

/**
 * Hand staged entries to the import queue and remember the jobs they became.
 *
 * Files go up in as few uploads as the route allows; identifiers are fetched
 * one request each. Until the queue answers, each entry is a row of its own,
 * so a download that fails says so beside its name instead of failing the rest.
 */
export function useImportSubmission() {
  const client = useQueryClient();
  const [jobs, setJobs] = useState<string[]>([]);
  const [rows, setRows] = useState<SendingRow[]>([]);
  const [busy, setBusy] = useState(false);

  const settle = useCallback((ids: string[], error?: unknown) => {
    const set = new Set(ids);
    setRows((previous) =>
      error === undefined
        ? previous.filter((row) => !set.has(row.id))
        : previous.map((row) =>
            set.has(row.id)
              ? {
                  ...row,
                  state: "failed" as const,
                  error: errorMessage(error, String(error)),
                }
              : row,
          ),
    );
  }, []);

  const submit = useCallback(
    async (entries: Staged[], projectId?: string) => {
      if (!entries.length) return;
      setBusy(true);
      setRows((previous) => [
        ...previous.filter((row) => !entries.some((entry) => entry.id === row.id)),
        ...entries.map((entry) => ({
          id: entry.id,
          name: entry.name,
          kind: entry.kind,
          state: "sending" as const,
        })),
      ]);
      const accepted = (id: string) => {
        setJobs((previous) => [...previous, id]);
        void client.invalidateQueries({ queryKey: ["library", "imports"] });
      };
      try {
        const files = entries.filter((entry) => entry.kind === "file");
        for (const batch of uploadBatches(files, (entry) => entry.file.size)) {
          const ids = batch.map((entry) => entry.id);
          try {
            accepted(
              (
                await libraryApi.upload(
                  batch.map((entry) => entry.file),
                  projectId,
                )
              ).id,
            );
            settle(ids);
          } catch (error) {
            settle(ids, error);
          }
        }
        const locators = entries.filter((entry) => entry.kind === "locator");
        let next = 0;
        const worker = async () => {
          while (next < locators.length) {
            const entry = locators[next++];
            if (!entry) return;
            try {
              const title = entry.name === entry.locator ? undefined : entry.name;
              accepted((await libraryApi.fetchPaper(entry.locator, projectId, title)).id);
              settle([entry.id]);
            } catch (error) {
              settle([entry.id], error);
            }
          }
        };
        await Promise.all(Array.from({ length: FETCH_CONCURRENCY }, worker));
      } finally {
        setBusy(false);
      }
    },
    [client, settle],
  );

  const dismiss = useCallback((id: string) => {
    setRows((previous) => previous.filter((row) => row.id !== id));
  }, []);

  return { jobs, rows, busy, submit, dismiss };
}

export type ImportSubmission = ReturnType<typeof useImportSubmission>;
