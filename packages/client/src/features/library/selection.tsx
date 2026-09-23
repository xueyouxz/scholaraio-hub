import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

/** How many papers one batch action may carry. */
export const SELECTION_CAP = 200;

/** What a batch add reported back, per paper. */
export interface BatchOutcome {
  added: string[];
  skipped: { id: string }[];
  failed: { id: string; reason: string }[];
}

export interface LibrarySelection {
  selected: Set<string>;
  /** paperId → the project it was just added to; drives the card's badge. */
  added: Map<string, string>;
  /** paperId → why the last batch action failed for it. */
  failed: Map<string, string>;
  notice: string | null;
  toggle: (id: string) => void;
  clear: () => void;
  note: (notice: string | null) => void;
  resolve: (outcome: BatchOutcome, project: string) => void;
}

const SelectionContext = createContext<LibrarySelection | null>(null);

/**
 * One selection for the whole library, kept while the user moves between views.
 *
 * Picking papers in one view and acting on them in another is the normal way
 * to work here, so the selected set belongs above the views, not inside one.
 * It is cleared when the project scope changes, because the set of papers it
 * refers to changes with it.
 */
export function LibrarySelectionProvider({ children }: { children: React.ReactNode }) {
  const [params] = useSearchParams();
  const project = params.get("project") ?? "";
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [added, setAdded] = useState<Map<string, string>>(new Map());
  const [failed, setFailed] = useState<Map<string, string>>(new Map());
  const [notice, setNotice] = useState<string | null>(null);

  const value = useMemo<LibrarySelection>(() => {
    const clear = () => {
      setSelected(new Set());
      setAdded(new Map());
      setFailed(new Map());
      setNotice(null);
    };
    return {
      selected,
      added,
      failed,
      notice,
      clear,
      note: setNotice,
      toggle: (id) => {
        setSelected((previous) => {
          const next = new Set(previous);
          if (next.has(id)) next.delete(id);
          else if (next.size >= SELECTION_CAP) {
            setNotice(`最多一次选择 ${SELECTION_CAP} 篇`);
            return previous;
          } else next.add(id);
          return next;
        });
        // A paper the user touches again is no longer carrying an old failure.
        setFailed((previous) => {
          if (!previous.has(id)) return previous;
          const next = new Map(previous);
          next.delete(id);
          return next;
        });
      },
      resolve: (outcome, project) => {
        setAdded((previous) => {
          const next = new Map(previous);
          for (const id of outcome.added) next.set(id, project);
          for (const item of outcome.skipped) next.set(item.id, project);
          return next;
        });
        setFailed((previous) => {
          const next = new Map(previous);
          for (const id of outcome.added) next.delete(id);
          for (const item of outcome.skipped) next.delete(item.id);
          for (const item of outcome.failed) next.set(item.id, item.reason);
          return next;
        });
        // Successes leave the selection; failures stay so they can be retried.
        setSelected((previous) => {
          const next = new Set(previous);
          for (const id of outcome.added) next.delete(id);
          for (const item of outcome.skipped) next.delete(item.id);
          return next;
        });
      },
    };
  }, [selected, added, failed, notice]);

  const lastProject = useRef(project);
  useEffect(() => {
    if (lastProject.current === project) return;
    lastProject.current = project;
    value.clear();
  }, [project, value]);

  return <SelectionContext value={value}>{children}</SelectionContext>;
}

export function useLibrarySelection(): LibrarySelection {
  const value = useContext(SelectionContext);
  if (!value) throw new Error("useLibrarySelection 必须在文献库视图内使用");
  return value;
}
