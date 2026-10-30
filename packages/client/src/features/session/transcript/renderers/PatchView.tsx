import { PatchDiff } from "@pierre/diffs/react";
import { diffOptions } from "./EditDiff";

/** Loaded lazily with the diff library, only once a file's diff is opened. */
export default function PatchView({ patch }: { patch: string }) {
  return (
    <div className="tool-diff">
      <PatchDiff patch={patch} options={diffOptions(patch)} />
    </div>
  );
}
