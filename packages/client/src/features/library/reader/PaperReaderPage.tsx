import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { usePageTitle } from "../../../app/components/NavigationLayout";
import { libraryApi } from "../../../core/library";
import { toLibraryPaperRef } from "../paperUtils";
import { PaperReaderView } from "./PaperReaderView";
import { ReaderSidebar } from "./ReaderSidebar";

export function PaperReaderPage() {
  const { paperId } = useParams<{ paperId: string }>();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const projectId = params.get("project");
  const { setTitle } = usePageTitle();
  const papers = useQuery({
    queryKey: ["library", "papers"],
    queryFn: ({ signal }) => libraryApi.papers(signal),
  });
  const project = useQuery({
    queryKey: ["library", "project", projectId],
    queryFn: ({ signal }) => libraryApi.project(projectId ?? "", signal),
    enabled: !!projectId,
  });
  const references = useMemo(() => {
    const members = new Set(project.data?.paperIds);
    return (papers.data?.papers ?? [])
      .filter((p) => !projectId || members.has(p.id))
      .map(toLibraryPaperRef);
  }, [papers.data, project.data, projectId]);
  const back = () => {
    const returnTo = params.get("returnTo");
    navigate(
      returnTo?.startsWith("/library?")
        ? returnTo
        : `/library?view=grid${projectId ? `&project=${encodeURIComponent(projectId)}` : ""}`,
    );
  };

  useEffect(() => {
    setTitle("阅读");
    return () => setTitle("");
  }, [setTitle]);

  return (
    <div className="flex overflow-hidden flex-1 min-h-0">
      <div className="hidden xl:flex min-h-0">
        <ReaderSidebar
          papers={references}
          currentPaperId={paperId ?? ""}
          onBack={back}
          projectId={projectId ?? undefined}
        />
      </div>
      <PaperReaderView
        paperId={paperId}
        leading={
          <button
            type="button"
            onClick={back}
            className="shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors border cursor-pointer bg-surface-container-high text-on-surface-variant border-outline-variant/30 hover:bg-surface-container"
          >
            ← 返回
          </button>
        }
      />
    </div>
  );
}
