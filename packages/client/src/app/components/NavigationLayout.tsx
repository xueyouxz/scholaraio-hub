import { type ContextType, useCallback, useEffect, useMemo, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { readStoredNumber, writeStored } from "../../core/browserStorage";
import { useHubEvents } from "../../core/hubEvents";
import { type NavigationLayoutContext, PageTitleContext } from "../../shared/layout";
import { SIDEBAR_WIDTH_COLLAPSED, Sidebar } from "./Sidebar";

const DESKTOP_BREAKPOINT = 1100;
const SIDEBAR_WIDTH_EXPANDED_DEFAULT = 248;
const SIDEBAR_WIDTH_KEY = "sidebarExpandedWidth";

function clampSidebarWidth(width: number): number {
  return Math.max(220, Math.min(420, width));
}

function getIsDesktop() {
  if (typeof window === "undefined") return true;
  return window.innerWidth > DESKTOP_BREAKPOINT;
}

export function NavigationLayout() {
  // Lists of projects and sessions stay current while the app is open.
  useHubEvents();
  const location = useLocation();
  const [isDesktop, setIsDesktop] = useState(getIsDesktop);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [pageTitle, setPageTitle] = useState("");
  const [expandedWidth, setExpandedWidth] = useState(() => {
    const saved = readStoredNumber(SIDEBAR_WIDTH_KEY);
    return saved ? clampSidebarWidth(saved) : SIDEBAR_WIDTH_EXPANDED_DEFAULT;
  });
  // While the user drags the edge, the column follows the pointer with no easing.
  const [resizing, setResizing] = useState(false);
  const resizeSidebar = useCallback((width: number, persist = true) => {
    const next = clampSidebarWidth(Math.round(width));
    setExpandedWidth(next);
    if (persist) writeStored(SIDEBAR_WIDTH_KEY, String(next));
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

  const layoutContext = useMemo<NavigationLayoutContext>(() => ({ isDesktop }), [isDesktop]);

  const pageTitleContext = useMemo<ContextType<typeof PageTitleContext>>(
    () => ({ setTitle: setPageTitle }),
    [],
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
                gridTemplateColumns: `${sidebarWidth}px minmax(0, 1fr)`,
                transition: resizing ? "none" : "grid-template-columns 220ms ease-in-out",
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
          onResizingChange={setResizing}
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
                // truncate clips to the line box: a full line height keeps descenders (g, y) whole.
                <h3 className="font-serif text-[1.25rem] font-bold text-primary leading-normal truncate">
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
