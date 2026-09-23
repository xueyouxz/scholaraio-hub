import { Navigate, useSearchParams } from "react-router-dom";
import { SearchPage } from "../search/SearchPage";

/** Query params that used to select a view, and the route that replaces each. */
const MOVED: Array<{ matches: (params: URLSearchParams) => boolean; to: string }> = [
  { matches: (params) => params.has("newProject") || params.get("manage") === "1", to: "import" },
  { matches: (params) => params.get("view") === "analysis", to: "insights" },
];

/**
 * Browsing the library, and the redirects from when a view was a query param.
 *
 * Links and bookmarks made before the views became routes still work: they
 * land on the same page, at its own address.
 */
export function LibraryPage() {
  const [params] = useSearchParams();
  const moved = MOVED.find((entry) => entry.matches(params));
  if (moved) {
    const rest = new URLSearchParams(params);
    rest.delete("manage");
    if (rest.get("view") === "analysis") rest.delete("view");
    const query = rest.toString();
    return <Navigate replace to={`/library/${moved.to}${query ? `?${query}` : ""}`} />;
  }
  return <SearchPage key={params.get("project") ?? ""} />;
}
