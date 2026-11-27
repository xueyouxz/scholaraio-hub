import { Suspense, lazy } from "react";
import { BrowserRouter, Navigate, Route, Routes, useParams } from "react-router-dom";
import { NavigationLayout } from "./components/NavigationLayout";
const LibraryLayout = lazy(() =>
  import("../features/library/LibraryLayout").then((module) => ({ default: module.LibraryLayout })),
);
const LibraryBrowsePage = lazy(() =>
  import("../features/library/LibraryBrowsePage").then((module) => ({
    default: module.LibraryBrowsePage,
  })),
);
const CollectionPage = lazy(() =>
  import("../features/library/CollectionPage").then((module) => ({
    default: module.CollectionPage,
  })),
);
const DocumentLibraryPage = lazy(() =>
  import("../features/library/DocumentLibraryPage").then((module) => ({
    default: module.DocumentLibraryPage,
  })),
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
const ProjectPage = lazy(() =>
  import("./pages/ProjectPage").then((module) => ({ default: module.ProjectPage })),
);
const CollectionsPage = lazy(() =>
  import("../features/library/CollectionsPage").then((module) => ({
    default: module.CollectionsPage,
  })),
);
/** A literature collection's page, fresh for each collection. */
function CollectionRoute() {
  const { collectionId = "" } = useParams();
  return <CollectionPage key={collectionId} collectionId={collectionId} />;
}
/** A project's page, fresh for each project. */
function ProjectRoute() {
  const { projectId = "" } = useParams();
  return <ProjectPage key={projectId} />;
}
/** Collections used to be workspaces; old links still land on them. */
function WorkspaceRedirect() {
  const { projectId = "" } = useParams();
  return <Navigate to={`/library/collections/${encodeURIComponent(projectId)}`} replace />;
}

export function App() {
  return (
    <BrowserRouter>
      <a className="sr-only focus:not-sr-only" href="#main-content">
        跳转到内容
      </a>
      <Suspense fallback={<output className="p-6">加载中…</output>}>
        <Routes>
          <Route element={<NavigationLayout />}>
            <Route path="/" element={<Navigate to="/projects" replace />} />
            <Route path="/library" element={<LibraryLayout />}>
              <Route index element={<LibraryBrowsePage />} />
              <Route path="collections" element={<CollectionsPage />} />
              <Route path="documents" element={<DocumentLibraryPage />} />
              <Route path="insights" element={<LibraryDashboard />} />
            </Route>
            <Route path="/library/collections/:collectionId" element={<CollectionRoute />} />
            <Route path="/library/:paperId" element={<ReaderPage />} />
            <Route path="/workspaces/:projectId" element={<WorkspaceRedirect />} />
            <Route path="/sessions" element={<SessionPage />} />
            <Route path="/sessions/:sessionId" element={<SessionPage />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/projects/:projectId" element={<ProjectRoute />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/skills" element={<SkillsPage />} />
            <Route path="/skills/:skillId" element={<SkillsPage />} />
            <Route path="*" element={<Navigate to="/projects" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
