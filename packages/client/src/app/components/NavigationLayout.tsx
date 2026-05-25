import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Outlet, useLocation, useOutletContext } from "react-router-dom";
import { Sidebar } from "./Sidebar";

const DESKTOP_BREAKPOINT = 1100;
export const SIDEBAR_WIDTH_COLLAPSED = 60;
export const SIDEBAR_WIDTH_EXPANDED_DEFAULT = 248;
export const SIDEBAR_WIDTH_MIN = 180;
export const SIDEBAR_WIDTH_MAX = 400;

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
  const location = useLocation();
  const [isDesktop, setIsDesktop] = useState(getIsDesktop);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [pageTitle, setPageTitle] = useState("");

  // Persisted expanded width — only read on mount; updates come from handleDragEnd.
  const [expandedWidth, setExpandedWidth] = useState(() => {
    const stored = localStorage.getItem("sidebarExpandedWidth");
    const parsed = stored ? Number.parseInt(stored, 10) : SIDEBAR_WIDTH_EXPANDED_DEFAULT;
    return Number.isNaN(parsed)
      ? SIDEBAR_WIDTH_EXPANDED_DEFAULT
      : Math.min(Math.max(parsed, SIDEBAR_WIDTH_MIN), SIDEBAR_WIDTH_MAX);
  });

  // Ref to the root grid container — mutated directly during drag to skip React.
  const layoutRef = useRef<HTMLDivElement>(null);

  /**
   * Called on every mousemove during a sidebar drag.
   * Writes gridTemplateColumns directly so there is zero React overhead and
   * both the sidebar cell and the content cell update in the same browser frame.
   */
  const handleDragMove = useCallback((width: number) => {
    const el = layoutRef.current;
    if (!el) return;
    el.style.transition = "none";
    el.style.gridTemplateColumns = `${width}px 1fr`;
  }, []);

  /**
   * Called once on mouseup. Syncs React state (triggers one re-render to
   * persist the value and restore the CSS transition via the style prop).
   */
  const handleDragEnd = useCallback((finalWidth: number) => {
    const clamped = Math.min(Math.max(finalWidth, SIDEBAR_WIDTH_MIN), SIDEBAR_WIDTH_MAX);
    setExpandedWidth(clamped);
    localStorage.setItem("sidebarExpandedWidth", String(clamped));
  }, []);

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

  const sidebarWidth = isSidebarCollapsed ? SIDEBAR_WIDTH_COLLAPSED : expandedWidth;

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

  const isSessionRoute = /^\/projects\/[^/]+\/sessions\/[^/]+/.test(location.pathname);
  const isPaperReaderRoute = /^\/library\/.+/.test(location.pathname);
  const isLibraryRoute = location.pathname === "/library";
  const isSkillsRoute = /^\/skills(\/|$)/.test(location.pathname);
  const isNewSessionRoute = location.pathname === "/new-session";
  const isFullscreenRoute =
    isSessionRoute || isPaperReaderRoute || isLibraryRoute || isSkillsRoute || isNewSessionRoute;

  return (
    <ProjectScopeContext value={projectScopeContext}>
      <PageTitleContext value={pageTitleContext}>
        {/*
         * Desktop: CSS Grid with two columns — sidebar track + content track.
         * Both update from the same single style prop, so they are always
         * pixel-perfect in sync. During drag, handleDragMove bypasses React and
         * mutates gridTemplateColumns directly; handleDragEnd fires once to
         * persist state and React restores the transition via the style prop.
         *
         * Mobile: plain block layout; sidebar is a fixed overlay.
         */}
        <div
          ref={layoutRef}
          className="min-h-screen bg-surface"
          style={
            isDesktop
              ? {
                  display: "grid",
                  gridTemplateColumns: `${sidebarWidth}px 1fr`,
                  transition: "grid-template-columns 220ms ease-in-out",
                }
              : undefined
          }
        >
          {/* Mobile overlay backdrop */}
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
            expandedWidth={expandedWidth}
            onDragMove={handleDragMove}
            onDragEnd={handleDragEnd}
          />

          {/* Main content — no margin/padding needed; grid track handles spacing */}
          <div
            className={`flex flex-col min-w-0 ${isFullscreenRoute ? "h-screen overflow-hidden" : "min-h-screen"}`}
          >
            {!isSessionRoute ? (
              <header className="sticky top-0 z-30 flex items-center h-[3.25rem] px-6 bg-surface border-b border-outline-variant/10">
                {pageTitle ? (
                  <h3 className="font-serif text-[1.65rem] font-bold text-primary leading-none">
                    {pageTitle}
                  </h3>
                ) : null}
              </header>
            ) : null}

            <main
              className={
                isFullscreenRoute
                  ? "flex-1 min-w-0 min-h-0 flex flex-col"
                  : "flex-1 min-w-0 px-6 py-8 flex flex-col"
              }
            >
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
