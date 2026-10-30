import { useEffect } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { collectionUrl } from "../../../core/library";
import { usePageTitle } from "../../../shared/layout";
import { PaperReaderView } from "./PaperReaderView";

export function PaperReaderPage() {
  const { paperId } = useParams<{ paperId: string }>();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const collectionId = params.get("collection");
  const { setTitle } = usePageTitle();
  const back = () => {
    const returnTo = params.get("returnTo");
    // Only a path within this app: never an address someone put in the link.
    const internal = returnTo?.startsWith("/") && !returnTo.startsWith("//");
    navigate(
      internal && returnTo
        ? returnTo
        : collectionId
          ? collectionUrl(collectionId)
          : "/library?view=grid",
    );
  };

  useEffect(() => {
    setTitle("阅读");
    return () => setTitle("");
  }, [setTitle]);

  return (
    <div className="flex overflow-hidden flex-1 min-h-0">
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
