import { useCallback, useState } from "react";
import type { PatchHunk } from "../renderers/tools/types";

interface ExpandedDiffResult {
  structuredPatch: PatchHunk[];
  diffHtml: string;
}

interface UseExpandedDiffOptions {
  filePath: string;
  oldString: string;
  newString: string;
  originalFile: string;
}

export function useExpandedDiff(_options: UseExpandedDiffOptions) {
  const [loading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result] = useState<ExpandedDiffResult | null>(null);

  const fetchExpandedDiff = useCallback(async () => {
    setError("Expanded diff is not available in this build");
  }, []);

  return { loading, error, result, fetchExpandedDiff };
}
