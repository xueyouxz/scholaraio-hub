/** A file the server stored for a session, as it is handed to the provider. */
export interface UploadedFile {
  /** Unique identifier (UUID) */
  id: string;
  /** Original filename from client */
  originalName: string;
  /** Sanitized filename on disk (UUID prefix + sanitized original) */
  name: string;
  /** Absolute path on server */
  path: string;
  /** File size in bytes */
  size: number;
  /** MIME type */
  mimeType: string;
}
