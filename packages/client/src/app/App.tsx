import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
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
          <Route path="/projects/:projectId/sessions/:sessionId" element={<SessionPage />} />
        </Route>
        <Route path="/projects/:projectId/file" element={<FilePage />} />
      </Routes>
    </BrowserRouter>
  );
}
