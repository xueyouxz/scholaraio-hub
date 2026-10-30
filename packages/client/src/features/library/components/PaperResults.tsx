import { LayoutGrid, LayoutList } from "lucide-react";
import type { ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import type { PaperSummary } from "../paperSummary";
import { PaperGridCard } from "./PaperGridCard";
import { PaperVirtualList } from "./PaperVirtualList";

/** How a page lays papers out: rows or cards. */
export type ViewMode = "list" | "grid";

/** The page's layout, kept in the URL (`view`) so a reload or a shared link keeps it. */
export function useViewMode(): [ViewMode, (view: ViewMode) => void] {
  const [params, setParams] = useSearchParams();
  const view: ViewMode = params.get("view") === "list" ? "list" : "grid";
  const setView = (next: ViewMode) =>
    setParams(
      (previous) => {
        const updated = new URLSearchParams(previous);
        updated.set("view", next);
        return updated;
      },
      { replace: true },
    );
  return [view, setView];
}

const VIEW_CHOICES = [
  { view: "list", label: "列表视图", Icon: LayoutList },
  { view: "grid", label: "卡片视图", Icon: LayoutGrid },
] as const;

/** The rows/cards switch; `buttonClassName` sizes its buttons like the toolbar around it. */
export function ViewModeToggle({
  view,
  onChange,
  buttonClassName,
}: {
  view: ViewMode;
  onChange: (view: ViewMode) => void;
  buttonClassName: string;
}) {
  return (
    <div className="flex items-center gap-0.5">
      {VIEW_CHOICES.map(({ view: choice, label, Icon }) => (
        <button
          key={choice}
          type="button"
          aria-label={label}
          aria-pressed={view === choice}
          onClick={() => onChange(choice)}
          className={`${buttonClassName} transition-colors ${
            view === choice
              ? "bg-primary/10 text-primary"
              : "text-on-surface-variant hover:bg-surface-container-high"
          }`}
        >
          <Icon className="w-4 h-4" />
        </button>
      ))}
    </div>
  );
}

/**
 * Papers laid out as virtualised rows or a grid of cards. Every page that
 * lists papers (the library, a search, a collection) draws them through here.
 */
export function PaperResults({
  view,
  papers,
  selectedId,
  onSelect,
  selectionMode = false,
  checkedIds,
  addedMap,
  renderCard,
  leading,
  listKey,
}: {
  view: ViewMode;
  papers: PaperSummary[];
  selectedId?: string | null;
  onSelect: (paper: PaperSummary) => void;
  /** Multi-select is on: a press checks a paper instead of opening it. */
  selectionMode?: boolean;
  checkedIds?: Set<string>;
  /** The collection each paper was just added to, shown on it. */
  addedMap?: Map<string, string>;
  /** A card of the page's own (keyed by paper id) in place of the default one; rows stay the same. */
  renderCard?: (paper: PaperSummary) => ReactNode;
  /** Cards shown before the papers: the grid's first cells, or a strip above the rows. */
  leading?: ReactNode[];
  /** Start the rows over (scrolled to the top) when this changes, e.g. a new query. */
  listKey?: string;
}) {
  if (view === "list")
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        {leading?.length ? (
          <div className="grid shrink-0 grid-cols-1 gap-2 md:grid-cols-2">{leading}</div>
        ) : null}
        <div className="min-h-0 flex-1">
          <PaperVirtualList
            key={listKey}
            papers={papers}
            selectedId={selectedId}
            onSelect={onSelect}
            selectionMode={selectionMode}
            checkedIds={checkedIds}
            addedMap={addedMap}
          />
        </div>
      </div>
    );
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="grid grid-cols-1 gap-3 pb-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {leading}
        {papers.map((paper) =>
          renderCard ? (
            renderCard(paper)
          ) : (
            <PaperGridCard
              key={paper.id}
              paper={paper}
              isSelected={!selectionMode && selectedId === paper.id}
              onClick={() => onSelect(paper)}
              selectionMode={selectionMode}
              isChecked={checkedIds?.has(paper.id) ?? false}
              addedLabel={addedMap?.get(paper.id) ?? null}
            />
          ),
        )}
      </div>
    </div>
  );
}
