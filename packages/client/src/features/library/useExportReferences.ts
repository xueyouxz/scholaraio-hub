import { useMutation } from "@tanstack/react-query";
import { libraryApi } from "../../core/library";

export interface ExportRequest {
  paperIds: string[];
  projectId?: string;
  format: string;
  style?: string;
}

/** Ask for a reference file and hand it to the browser as a download. */
export function useExportReferences() {
  return useMutation({
    mutationFn: (request: ExportRequest) => libraryApi.exportReferences(request),
    onSuccess: (file) => {
      const url = URL.createObjectURL(new Blob([file.content], { type: file.contentType }));
      const link = document.createElement("a");
      link.href = url;
      link.download = file.filename;
      link.click();
      // The object URL is the download's only holder; release it once it is used.
      URL.revokeObjectURL(url);
    },
  });
}
