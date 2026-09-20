import { Suspense, lazy } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { NavigationLayout } from "./components/NavigationLayout";
const LibraryPage = lazy(() =>
  import("../features/library/LibraryPage").then((module) => ({ default: module.LibraryPage })),
);
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
            <Route path="/library" element={<LibraryPage />} />
            <Route path="/library/:paperId" element={<ReaderPage />} />
            <Route path="/sessions" element={<SessionPage />} />
            <Route path="/sessions/:sessionId" element={<SessionPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/library" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
