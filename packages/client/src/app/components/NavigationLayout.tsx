import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Outlet, useLocation, useOutletContext } from "react-router-dom";
import { Sidebar } from "./Sidebar";

const DESKTOP_BREAKPOINT = 1100;
export const SIDEBAR_WIDTH_COLLAPSED = 60;
export const SIDEBAR_WIDTH_EXPANDED_DEFAULT = 248;

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
  const [expandedWidth, setExpandedWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem("sidebarExpandedWidth"));
      return saved ? Math.max(220, Math.min(420, saved)) : SIDEBAR_WIDTH_EXPANDED_DEFAULT;
    } catch {
      return SIDEBAR_WIDTH_EXPANDED_DEFAULT;
    }
  });
  const resizeSidebar = (width: number) => {
    const next = Math.max(220, Math.min(420, width));
    setExpandedWidth(next);
    try {
      localStorage.setItem("sidebarExpandedWidth", String(next));
    } catch (error) {
      console.warn("无法保存侧栏宽度", error);
    }
  };

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

  // New chats keep the layout title bar; an open session renders its own header.
  const isSessionRoute = /^\/sessions\/[^/]+/.test(location.pathname);
  const isNewSessionRoute = location.pathname === "/sessions";
  const isPaperReaderRoute = /^\/library\/.+/.test(location.pathname);
  const isLibraryRoute = location.pathname === "/library";
  const isFullscreenRoute =
    isSessionRoute ||
    isNewSessionRoute ||
    isPaperReaderRoute ||
    isLibraryRoute ||
    location.pathname.startsWith("/skills");

  return (
    <PageTitleContext value={pageTitleContext}>
      <div
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
          width={expandedWidth}
          onWidthChange={resizeSidebar}
        />

        {/* Main content — no margin/padding needed; grid track handles spacing */}
        <div
          className={`flex flex-col min-w-0 ${isFullscreenRoute ? "h-dvh overflow-hidden" : "min-h-dvh"}`}
        >
          {!isSessionRoute ? (
            <header
              className={`sticky top-0 z-30 flex items-center h-[3.25rem] shrink-0 px-6 ${!isDesktop ? "pl-16" : ""} bg-surface border-b border-outline-variant/10`}
            >
              {pageTitle ? (
                <h3 className="font-serif text-[1.65rem] font-bold text-primary leading-none">
                  {pageTitle}
                </h3>
              ) : null}
            </header>
          ) : null}

          <main
            id="main-content"
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
  );
}

export function useNavigationLayout() {
  return useOutletContext<NavigationLayoutContext>();
}
