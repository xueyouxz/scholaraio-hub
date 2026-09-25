import { FilePen } from "lucide-react";
import { Suspense, lazy, useState } from "react";
import { Chevron } from "./renderers/ToolCallRow";
import { DiffStatsLabel } from "./renderers/blocks";
import { type FileChange, changesByFile, totalStats } from "./renderers/fileChanges";
import { fileName } from "./renderers/types";

const PatchView = lazy(() => import("./renderers/PatchView"));

/** Files listed before "Show N more". */
const VISIBLE_FILES = 3;

/**
 * What a finished turn changed, file by file with added and removed lines,
 * the way Claude's apps close a turn. Each file opens to its diff.
 */
export function FileChangesCard({ changes }: { changes: readonly FileChange[] }) {
  const files = changesByFile(changes);
  const [showAll, setShowAll] = useState(false);
  const [open, setOpen] = useState<string | undefined>();
  const total = totalStats(files);
  const shown = showAll ? files : files.slice(0, VISIBLE_FILES);
  return (
    <section className="file-changes timeline-item" aria-label="本轮修改的文件">
      <header className="file-changes-header">
        <FilePen size={14} aria-hidden="true" />
        <span>
          Edited {files.length} {files.length === 1 ? "file" : "files"}
        </span>
        {total ? <DiffStatsLabel {...total} /> : null}
      </header>
      <ul>
        {shown.map((file) => (
          <li key={file.path}>
            <button
              type="button"
              className="file-changes-row"
              aria-expanded={open === file.path}
              disabled={!file.patches.length}
              onClick={() => setOpen((current) => (current === file.path ? undefined : file.path))}
              title={file.path}
            >
              <span className="file-changes-name">{fileName(file.path)}</span>
              <span className="file-changes-dir">{directoryOf(file.path)}</span>
              <DiffStatsLabel added={file.added} removed={file.removed} />
              {file.patches.length ? <Chevron open={open === file.path} /> : null}
            </button>
            {open === file.path ? (
              <div className="file-changes-diff">
                <Suspense fallback={<span className="tool-pending-message">加载差异…</span>}>
                  {keyedPatches(file.patches).map(({ key, patch }) => (
                    <PatchView key={key} patch={patch} />
                  ))}
                </Suspense>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {files.length > VISIBLE_FILES ? (
        <button type="button" className="file-changes-more" onClick={() => setShowAll((v) => !v)}>
          {showAll ? "Show less" : `Show ${files.length - VISIBLE_FILES} more`}
        </button>
      ) : null}
    </section>
  );
}

/** Each diff keyed by its content, and which repeat of that content it is. */
function keyedPatches(patches: readonly string[]): { key: string; patch: string }[] {
  const seen = new Map<string, number>();
  return patches.map((patch) => {
    const repeat = seen.get(patch) ?? 0;
    seen.set(patch, repeat + 1);
    return { key: `${repeat}:${patch}`, patch };
  });
}

function directoryOf(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts.length > 1 ? parts.slice(-3, -1).join("/") : "";
}
