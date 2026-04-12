import { NavLink, Outlet } from "react-router-dom";

const links = [
  { to: "/projects", label: "Projects" },
  { to: "/sessions", label: "Sessions" },
  { to: "/agents", label: "Agents" },
  { to: "/new-session", label: "New Session" },
  { to: "/settings", label: "Settings" },
];

export function AppShell() {
  return (
    <div className="shell">
      <aside className="panel">
        <div className="panel-header hero">
          <h1>Scholaraio Hub</h1>
          <p>Local workbench rebuilt against the current server API.</p>
        </div>
        <div className="panel-body stack">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) => `button ${isActive ? "primary" : ""}`}
            >
              {link.label}
            </NavLink>
          ))}
        </div>
      </aside>
      <main className="panel" style={{ gridColumn: "span 2" }}>
        <Outlet />
      </main>
    </div>
  );
}
