import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Outlet, useOutletContext } from "react-router-dom";
import { Sidebar } from "./Sidebar";

const DESKTOP_BREAKPOINT = 1100;
const SIDEBAR_WIDTH_EXPANDED = 248;
const SIDEBAR_WIDTH_COLLAPSED = 84;

// ─── PageTitle context ────────────────────────────────────────────────────────

interface PageTitleContextValue {
  title: string;
  setTitle: (title: string) => void;
}

const PageTitleContext = createContext<PageTitleContextValue>({
  title: "",
  setTitle: () => {},
});

export function usePageTitle() {
  return useContext(PageTitleContext);
}

// ─── ProjectScope context ─────────────────────────────────────────────────────

export type SelectedProvider = "claude" | "codex" | null;

interface ProjectScopeContextValue {
  selectedProvider: SelectedProvider;
  selectedProjectId: string | null;
  setSelectedProvider: (provider: SelectedProvider) => void;
  setSelectedProjectId: (id: string | null) => void;
}

const ProjectScopeContext = createContext<ProjectScopeContextValue>({
  selectedProvider: null,
  selectedProjectId: null,
  setSelectedProvider: () => {},
  setSelectedProjectId: () => {},
});

export function useProjectScope() {
  return useContext(ProjectScopeContext);
}

// ─── NavigationLayout context (sidebar toggle) ───────────────────────────────

export interface NavigationLayoutContext {
  isDesktop: boolean;
  isSidebarCollapsed: boolean;
  toggleSidebar: () => void;
  closeMobileSidebar: () => void;
}

function getIsDesktop() {
  if (typeof window === "undefined") return true;
  return window.innerWidth > DESKTOP_BREAKPOINT;
}

export function NavigationLayout() {
  const [isDesktop, setIsDesktop] = useState(getIsDesktop);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [pageTitle, setPageTitle] = useState("");

  // Restore provider + project from localStorage
  const [selectedProvider, setSelectedProviderState] = useState<SelectedProvider>(() => {
    const stored = localStorage.getItem("selectedProvider");
    return stored === "claude" || stored === "codex" ? stored : null;
  });
  const [selectedProjectId, setSelectedProjectIdState] = useState<string | null>(() => {
    return localStorage.getItem("selectedProjectId");
  });

  const setSelectedProvider = useCallback((provider: SelectedProvider) => {
    setSelectedProviderState(provider);
    if (provider) {
      localStorage.setItem("selectedProvider", provider);
    } else {
      localStorage.removeItem("selectedProvider");
    }
  }, []);

  const setSelectedProjectId = useCallback((id: string | null) => {
    setSelectedProjectIdState(id);
    if (id) {
      localStorage.setItem("selectedProjectId", id);
    } else {
      localStorage.removeItem("selectedProjectId");
    }
  }, []);

  useEffect(() => {
    const handleResize = () => {
      const nextIsDesktop = getIsDesktop();
      setIsDesktop(nextIsDesktop);
      if (nextIsDesktop) setIsMobileSidebarOpen(false);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const toggleSidebar = useCallback(() => {
    if (isDesktop) {
      setIsSidebarCollapsed((v) => !v);
    } else {
      setIsMobileSidebarOpen((v) => !v);
    }
  }, [isDesktop]);

  const closeMobileSidebar = useCallback(() => setIsMobileSidebarOpen(false), []);

  const sidebarWidth = isDesktop
    ? isSidebarCollapsed
      ? SIDEBAR_WIDTH_COLLAPSED
      : SIDEBAR_WIDTH_EXPANDED
    : 0;

  const layoutContext = useMemo<NavigationLayoutContext>(
    () => ({
      isDesktop,
      isSidebarCollapsed,
      toggleSidebar,
      closeMobileSidebar,
    }),
    [isDesktop, isSidebarCollapsed, toggleSidebar, closeMobileSidebar],
  );

  const pageTitleContext = useMemo<PageTitleContextValue>(
    () => ({ title: pageTitle, setTitle: setPageTitle }),
    [pageTitle],
  );

  const projectScopeContext = useMemo<ProjectScopeContextValue>(
    () => ({
      selectedProvider,
      selectedProjectId,
      setSelectedProvider,
      setSelectedProjectId,
    }),
    [selectedProvider, selectedProjectId, setSelectedProvider, setSelectedProjectId],
  );

  return (
    <ProjectScopeContext value={projectScopeContext}>
      <PageTitleContext value={pageTitleContext}>
        <div className="flex min-h-screen bg-surface">
          {/* Mobile overlay */}
          {!isDesktop && isMobileSidebarOpen ? (
            <button
              type="button"
              aria-label="Close navigation"
              className="fixed inset-0 z-40 bg-on-surface/20 border-0 p-0 cursor-pointer"
              onClick={closeMobileSidebar}
            />
          ) : null}

          <Sidebar
            isDesktop={isDesktop}
            isCollapsed={isSidebarCollapsed}
            isOpen={isDesktop || isMobileSidebarOpen}
            onToggle={toggleSidebar}
            onClose={closeMobileSidebar}
          />

          {/* Main content area */}
          <div
            className="flex flex-col flex-1 min-w-0 min-h-screen transition-all duration-[220ms] ease-in-out"
            style={{ marginLeft: isDesktop ? `${sidebarWidth}px` : 0 }}
          >
            {/* TopNav */}
            <header className="sticky top-0 z-30 flex items-center h-[3.25rem] px-6 bg-surface border-b border-outline-variant/30">
              {pageTitle ? (
                <h3 className="font-serif text-[1.65rem] font-bold text-primary leading-none">
                  {pageTitle}
                </h3>
              ) : null}
            </header>

            {/* Page content */}
            <main className="flex-1 min-w-0 p-6">
              <Outlet context={layoutContext} />
            </main>
          </div>
        </div>
      </PageTitleContext>
    </ProjectScopeContext>
  );
}

export function useNavigationLayout() {
  return useOutletContext<NavigationLayoutContext>();
}
