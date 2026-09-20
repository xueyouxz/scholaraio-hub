import { MultiFileDiff, PatchDiff } from "@pierre/diffs/react";

export function SessionDiff({ input }: { input: unknown }) {
  if (!input || typeof input !== "object") return null;
  const data = input as Record<string, unknown>;
  const patch = data.patch ?? data.diff;
  if (typeof patch === "string" && patch.includes("@@")) return <PatchDiff patch={patch} />;
  if (typeof data.old_string === "string" && typeof data.new_string === "string") {
    const name = typeof data.file_path === "string" ? data.file_path : "file";
    return (
      <MultiFileDiff
        oldFile={{ name, contents: data.old_string }}
        newFile={{ name, contents: data.new_string }}
      />
    );
  }
  return null;
}
