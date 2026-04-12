import type { FileContentResponse } from "@scholaraio-hub/shared";
import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../../core/api";

function stripHtml(value: string): string {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}

export function FilePage() {
  const { projectId = "" } = useParams();
  const [params] = useSearchParams();
  const filePath = params.get("path") ?? "";
  const [file, setFile] = useState<FileContentResponse | null>(null);
  const [error, setError] = useState("");
  const renderedText = file?.renderedMarkdownHtml
    ? stripHtml(file.renderedMarkdownHtml)
    : file?.highlightedHtml
      ? stripHtml(file.highlightedHtml)
      : file?.content;

  useEffect(() => {
    if (!projectId || !filePath) return;
    void (async () => {
      try {
        const data = await api.getFile(projectId, filePath, true);
        setFile(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load file");
      }
    })();
  }, [projectId, filePath]);

  return (
    <div className="shell" style={{ gridTemplateColumns: "1fr" }}>
      <main className="panel">
        <div className="panel-header">
          <Link to="/sessions" className="button">
            Back
          </Link>
        </div>
        <div className="panel-body stack">
          <div className="muted">{filePath}</div>
          {error ? <div className="empty">{error}</div> : null}
          <pre>{renderedText}</pre>
        </div>
      </main>
    </div>
  );
}
