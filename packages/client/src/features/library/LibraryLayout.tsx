import { ChartNoAxesCombined, Plus, Search } from "lucide-react";
import { NavLink, Outlet, useSearchParams } from "react-router-dom";
import { ImportDialog } from "./components/ImportDialog";
import { LibrarySelectionBar } from "./components/LibrarySelectionBar";
import { LibrarySelectionProvider } from "./selection";

/**
 * The two ways to look at the library, as places rather than actions.
 *
 * Browsing and analysing are co-equal views of one collection, so they are
 * tabs. Importing is not a place — it is something done to the collection
 * from wherever the user is — so it opens as a dialog over the current view.
 */
const TABS = [
  { path: "", label: "检索", icon: Search },
  { path: "insights", label: "分析", icon: ChartNoAxesCombined },
];

export function LibraryLayout() {
  const [params, setParams] = useSearchParams();
  const importing = params.get("import") === "1";
  const closeImport = () =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.delete("import");
        return next;
      },
      { replace: true },
    );
  return (
    <LibrarySelectionProvider>
      <div className="flex-1 min-h-0 flex flex-col">
        <nav aria-label="文献库视图" className="shrink-0 flex items-center gap-1 px-6 pt-3">
          {TABS.map(({ path, label, icon: Icon }) => (
            <NavLink
              key={label}
              to={`/library${path ? `/${path}` : ""}`}
              end={!path}
              className={({ isActive }) =>
                `flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-on-surface-variant hover:bg-surface-container-high"
                }`
              }
            >
              <Icon className="w-3.5 h-3.5" aria-hidden="true" />
              {label}
            </NavLink>
          ))}
          <button
            type="button"
            onClick={() =>
              setParams((previous) => {
                const next = new URLSearchParams(previous);
                next.set("import", "1");
                return next;
              })
            }
            className="ml-auto inline-flex items-center gap-1.5 rounded-full signature-gradient px-4 py-1.5 text-sm font-semibold text-on-primary active:scale-95 border-0 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            导入文献
          </button>
        </nav>
        <Outlet />
        <LibrarySelectionBar />
        {importing ? <ImportDialog onClose={closeImport} /> : null}
      </div>
    </LibrarySelectionProvider>
  );
}
