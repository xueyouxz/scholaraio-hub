import { createContext, useContext, useMemo, useState } from "react";

/** How many papers one batch action may carry. */
export const SELECTION_CAP = 200;

/** What a batch add reported back, per paper. */
export interface BatchOutcome {
  added: string[];
  skipped: { id: string }[];
}

export interface LibrarySelection {
  selected: Set<string>;
  /** paperId → the project it was just added to; drives the card's badge. */
  added: Map<string, string>;
  notice: string | null;
  toggle: (id: string) => void;
  /** Make these the selection, up to the cap: a lasso picks a region at once. */
  selectMany: (ids: string[]) => void;
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
 */
export function LibrarySelectionProvider({ children }: { children: React.ReactNode }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [added, setAdded] = useState<Map<string, string>>(new Map());
  const [notice, setNotice] = useState<string | null>(null);

  const value = useMemo<LibrarySelection>(() => {
    const clear = () => {
      setSelected(new Set());
      setAdded(new Map());
      setNotice(null);
    };
    return {
      selected,
      added,
      notice,
      clear,
      note: setNotice,
      selectMany: (ids) => {
        setSelected(new Set(ids.slice(0, SELECTION_CAP)));
        setNotice(ids.length > SELECTION_CAP ? `最多一次选择 ${SELECTION_CAP} 篇` : null);
      },
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
      },
      resolve: (outcome, project) => {
        setAdded((previous) => {
          const next = new Map(previous);
          for (const id of outcome.added) next.set(id, project);
          for (const item of outcome.skipped) next.set(item.id, project);
          return next;
        });
        // Papers now in the workspace leave the selection.
        setSelected((previous) => {
          const next = new Set(previous);
          for (const id of outcome.added) next.delete(id);
          for (const item of outcome.skipped) next.delete(item.id);
          return next;
        });
      },
    };
  }, [selected, added, notice]);

  return <SelectionContext value={value}>{children}</SelectionContext>;
}

export function useLibrarySelection(): LibrarySelection {
  const value = useContext(SelectionContext);
  if (!value) throw new Error("useLibrarySelection 必须在文献库视图内使用");
  return value;
}
