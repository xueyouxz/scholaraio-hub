import type { UploadedFile } from "@scholaraio-hub/shared";

export interface UploadProgress {
  fileId: string;
  fileName: string;
  bytesUploaded: number;
  totalBytes: number;
  percent: number;
}

export interface AttachmentUploadFailure {
  fileId: string;
  fileName: string;
  message: string;
}

export interface AttachmentUploadSnapshot {
  attachments: UploadedFile[];
  uploadProgress: UploadProgress[];
}
