import type React from "react";
import ReaderDocumentSection from "../sections/ReaderDocumentSection";
import ReaderInsightsSection from "../sections/ReaderInsightsSection";
import ReaderWorkspaceModalSection from "../sections/ReaderWorkspaceModalSection";

const ReaderPageReference: React.FC = () => (
  <div className="flex-1 flex min-h-screen bg-surface overflow-hidden relative">
    <ReaderDocumentSection />
    <ReaderInsightsSection />
    <ReaderWorkspaceModalSection />
  </div>
);

export default ReaderPageReference;
