import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { LibraryPage } from "../features/library/LibraryPage";
import { PaperReaderPage } from "../features/library/reader/PaperReaderPage";
import { SearchPage } from "../features/search/SearchPage";
import { NavigationLayout } from "./components/NavigationLayout";
import { AgentsPage } from "./pages/AgentsPage";
import { FilePage } from "./pages/FilePage";
import { NewSessionPage } from "./pages/NewSessionPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { SessionPage } from "./pages/SessionPage";
import { SettingsPage } from "./pages/SettingsPage";

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
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/library/:paperId" element={<PaperReaderPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/projects/:projectId/sessions/:sessionId" element={<SessionPage />} />
        </Route>
        <Route path="/projects/:projectId/file" element={<FilePage />} />
      </Routes>
    </BrowserRouter>
  );
}
