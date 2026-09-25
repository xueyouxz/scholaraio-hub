import { MultiFileDiff, PatchDiff } from "@pierre/diffs/react";
import { editPatch } from "./patch";
import { field } from "./types";

/**
 * Light like the rest of the app (the diff would otherwise follow the OS
 * theme), unified like a terminal diff. The row above already names a single
 * file, so its header shows only when a patch spans several.
 */
export function diffOptions(patch?: string) {
  const files = patch ? (patch.match(/^\+\+\+ /gm) ?? []).length : 1;
  return {
    themeType: "light",
    diffStyle: "unified",
    overflow: "wrap",
    disableFileHeader: files <= 1,
  } as const;
}

/** Loaded lazily: the diff library is heavy and only needed once an edit is shown. */
export default function EditDiff({ input, detail }: { input: unknown; detail: unknown }) {
  const patch = editPatch(input, detail);
  if (patch)
    return (
      <div className="tool-diff">
        <PatchDiff patch={patch} options={diffOptions(patch)} />
      </div>
    );
  const oldString = field(input, "old_string");
  const newString = field(input, "new_string");
  if (!oldString && !newString) return null;
  const name = field(input, "file_path") || "file";
  return (
    <div className="tool-diff">
      <MultiFileDiff
        oldFile={{ name, contents: oldString }}
        newFile={{ name, contents: newString }}
        options={diffOptions()}
      />
    </div>
  );
}
