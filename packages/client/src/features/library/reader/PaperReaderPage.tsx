import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { usePageTitle } from "../../../app/components/NavigationLayout";
import { PaperReaderView } from "./PaperReaderView";

export function PaperReaderPage() {
  const { paperId } = useParams<{ paperId: string }>();
  const navigate = useNavigate();
  const { setTitle } = usePageTitle();

  useEffect(() => {
    setTitle("阅读");
    return () => setTitle("");
  }, [setTitle]);

  return (
    <div className="flex overflow-hidden h-[calc(100vh-3.25rem)]">
      <PaperReaderView
        paperId={paperId}
        leading={
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors border cursor-pointer bg-surface-container-high text-on-surface-variant border-outline-variant/30 hover:bg-surface-container"
          >
            ← 返回
          </button>
        }
      />
    </div>
  );
}
