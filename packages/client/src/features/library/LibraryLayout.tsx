import { ChartNoAxesCombined, Search, Upload } from "lucide-react";
import { NavLink, Outlet, useSearchParams } from "react-router-dom";
import { LibrarySelectionBar } from "./components/LibrarySelectionBar";
import { LibrarySelectionProvider } from "./selection";

/**
 * The three ways to work with the library, as places rather than actions.
 *
 * Browsing, importing and analysing are co-equal views of one collection, so
 * they are tabs: linkable, restorable by the back button, and visible before
 * they are needed.
 */
const TABS = [
  { path: "", label: "检索", icon: Search },
  { path: "import", label: "导入", icon: Upload },
  { path: "insights", label: "分析", icon: ChartNoAxesCombined },
];

export function LibraryLayout() {
  const [params] = useSearchParams();
  const project = params.get("project");
  // Only the project carries across tabs: a query or a sort belongs to the
  // view that owns it.
  const scope = project ? `?project=${encodeURIComponent(project)}` : "";
  return (
    <LibrarySelectionProvider>
      <div className="flex-1 min-h-0 flex flex-col">
        <nav aria-label="文献库视图" className="shrink-0 flex items-center gap-1 px-6 pt-3">
          {TABS.map(({ path, label, icon: Icon }) => (
            <NavLink
              key={label}
              to={`/library${path ? `/${path}` : ""}${scope}`}
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
        </nav>
        <Outlet />
        <LibrarySelectionBar />
      </div>
    </LibrarySelectionProvider>
  );
}
