import { Suspense, lazy } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { NavigationLayout } from "./components/NavigationLayout";
const LibraryLayout = lazy(() =>
  import("../features/library/LibraryLayout").then((module) => ({ default: module.LibraryLayout })),
);
const LibraryPage = lazy(() =>
  import("../features/library/LibraryPage").then((module) => ({ default: module.LibraryPage })),
);
const LibraryDashboard = lazy(() => import("../features/library/LibraryDashboard"));
const ReaderPage = lazy(() =>
  import("../features/library/reader/PaperReaderPage").then((module) => ({
    default: module.PaperReaderPage,
  })),
);
const SessionPage = lazy(() =>
  import("./pages/SessionPage").then((module) => ({ default: module.SessionPage })),
);
const SettingsPage = lazy(() =>
  import("./pages/SettingsPage").then((module) => ({ default: module.SettingsPage })),
);
const SkillsPage = lazy(() =>
  import("../features/skills/SkillsPage").then((module) => ({ default: module.SkillsPage })),
);
const ProjectsPage = lazy(() =>
  import("./pages/ProjectsPage").then((module) => ({ default: module.ProjectsPage })),
);
const AgentsPage = lazy(() =>
  import("./pages/AgentsPage").then((module) => ({ default: module.AgentsPage })),
);
export function App() {
  return (
    <BrowserRouter>
      <a className="sr-only focus:not-sr-only" href="#main-content">
        跳转到内容
      </a>
      <Suspense fallback={<output className="p-6">加载中…</output>}>
        <Routes>
          <Route element={<NavigationLayout />}>
            <Route path="/" element={<Navigate to="/library" replace />} />
            <Route path="/library" element={<LibraryLayout />}>
              <Route index element={<LibraryPage />} />
              <Route path="import" element={<Navigate replace to="/library?import=1" />} />
              <Route path="insights" element={<LibraryDashboard />} />
            </Route>
            <Route path="/library/:paperId" element={<ReaderPage />} />
            <Route path="/sessions" element={<SessionPage />} />
            <Route path="/sessions/:sessionId" element={<SessionPage />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/agents" element={<AgentsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/skills" element={<SkillsPage />} />
            <Route path="/skills/:skillId" element={<SkillsPage />} />
            <Route path="/new-session" element={<Navigate to="/sessions" replace />} />
            <Route path="*" element={<Navigate to="/library" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
