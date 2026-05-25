import { Suspense, lazy } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { NavigationLayout } from "./components/NavigationLayout";
import { AgentsPage } from "./pages/AgentsPage";
import { FilePage } from "./pages/FilePage";
import { NewSessionPage } from "./pages/NewSessionPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { SessionPage } from "./pages/SessionPage";
import { SettingsPage } from "./pages/SettingsPage";

const PaperReaderPage = lazy(() =>
  import("../features/library/reader/PaperReaderPage").then((m) => ({
    default: m.PaperReaderPage,
  })),
);
const SearchPage = lazy(() =>
  import("../features/search/SearchPage").then((m) => ({ default: m.SearchPage })),
);
const SkillsPage = lazy(() =>
  import("../features/skills/SkillsPage").then((m) => ({ default: m.SkillsPage })),
);
const DebugStreamPage = lazy(() =>
  import("../features/debug/DebugStreamPage").then((m) => ({ default: m.DebugStreamPage })),
);

function PageFallback() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <span className="text-xs font-mono text-on-surface-variant animate-pulse">加载中…</span>
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<NavigationLayout />}>
          <Route path="/" element={<Navigate to="/projects" replace />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/agents" element={<AgentsPage />} />
          <Route path="/new-session" element={<NewSessionPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/projects/:projectId/sessions/:sessionId" element={<SessionPage />} />
          <Route
            path="/library"
            element={
              <Suspense fallback={<PageFallback />}>
                <SearchPage />
              </Suspense>
            }
          />
          <Route
            path="/library/:paperId"
            element={
              <Suspense fallback={<PageFallback />}>
                <PaperReaderPage />
              </Suspense>
            }
          />
          <Route
            path="/skills"
            element={
              <Suspense fallback={<PageFallback />}>
                <SkillsPage />
              </Suspense>
            }
          />
          <Route
            path="/skills/:skillId"
            element={
              <Suspense fallback={<PageFallback />}>
                <SkillsPage />
              </Suspense>
            }
          />
        </Route>
        <Route path="/projects/:projectId/file" element={<FilePage />} />
        {import.meta.env.DEV ? (
          <>
            <Route
              path="/debug/stream"
              element={
                <Suspense fallback={<PageFallback />}>
                  <DebugStreamPage />
                </Suspense>
              }
            />
            <Route
              path="/debug/stream/:sessionId"
              element={
                <Suspense fallback={<PageFallback />}>
                  <DebugStreamPage />
                </Suspense>
              }
            />
          </>
        ) : null}
      </Routes>
    </BrowserRouter>
  );
}
