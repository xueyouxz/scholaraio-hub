import type React from "react";
import SidebarReference from "../sections/SidebarReference";
import TopNavReference from "../sections/TopNavReference";

interface AppShellReferenceProps {
  title: string;
  children: React.ReactNode;
  sidebarCollapsed?: boolean;
  settingsDrawerOpen?: boolean;
}

const AppShellReference: React.FC<AppShellReferenceProps> = ({
  title,
  children,
  sidebarCollapsed = false,
  settingsDrawerOpen = false,
}) => {
  const sidebarWidth = sidebarCollapsed ? 84 : 248;

  return (
    <div className="flex min-h-screen bg-surface text-on-surface font-sans selection:bg-primary/20 selection:text-primary overflow-hidden">
      <SidebarReference collapsed={sidebarCollapsed} menuOpen />
      <main
        className="flex-1 flex flex-col h-screen overflow-hidden relative"
        style={{ marginLeft: `${sidebarWidth}px` }}
      >
        <TopNavReference
          title={title}
          drawerOpen={settingsDrawerOpen}
          sidebarWidth={sidebarWidth}
        />
        <div className="flex-1 mt-[3.25rem] overflow-hidden relative">{children}</div>
      </main>
    </div>
  );
};

export default AppShellReference;
