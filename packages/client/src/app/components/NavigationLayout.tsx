import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";

export function NavigationLayout() {
  return (
    <div className="workbench-shell">
      <Sidebar />
      <main className="workbench-content">
        <Outlet />
      </main>
    </div>
  );
}
