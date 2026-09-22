import { MultiFileDiff, PatchDiff } from "@pierre/diffs/react";
import { editPatch } from "./patch";
import { field } from "./types";

/** Loaded lazily: the diff library is heavy and only needed once an edit is shown. */
export default function EditDiff({ input, detail }: { input: unknown; detail: unknown }) {
  const patch = editPatch(input, detail);
  if (patch) return <PatchDiff patch={patch} />;
  const oldString = field(input, "old_string");
  const newString = field(input, "new_string");
  if (!oldString && !newString) return null;
  const name = field(input, "file_path") || "file";
  return (
    <MultiFileDiff
      oldFile={{ name, contents: oldString }}
      newFile={{ name, contents: newString }}
    />
  );
}
