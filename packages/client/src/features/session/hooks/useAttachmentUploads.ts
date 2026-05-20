import type { UploadedFile } from "@scholaraio-hub/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../core/api";
import { generateUUID } from "../../../shared/lib/uuid";
import type {
  AttachmentUploadFailure,
  AttachmentUploadSnapshot,
  UploadProgress,
} from "../composer/types";

interface UseAttachmentUploadsOptions {
  projectId: string;
  sessionId?: string;
  ensureSessionId?: () => Promise<string>;
  onUploadError?: (failure: AttachmentUploadFailure) => void;
}

export function useAttachmentUploads({
  projectId,
  sessionId,
  ensureSessionId,
  onUploadError,
}: UseAttachmentUploadsOptions) {
  const [activeSessionId, setActiveSessionId] = useState(sessionId);
  const [attachments, setAttachments] = useState<UploadedFile[]>([]);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress[]>([]);

  const activeSessionIdRef = useRef(activeSessionId);
  const attachmentsRef = useRef(attachments);
  const pendingUploadsRef = useRef<Map<string, Promise<UploadedFile | null>>>(new Map());
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());

  useEffect(() => {
    if (sessionId) {
      activeSessionIdRef.current = sessionId;
      setActiveSessionId(sessionId);
    }
  }, [sessionId]);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  useEffect(() => {
    return () => {
      for (const controller of abortControllersRef.current.values()) {
        controller.abort();
      }
    };
  }, []);

  const resolveSessionId = useCallback(async () => {
    if (activeSessionIdRef.current) return activeSessionIdRef.current;
    if (!ensureSessionId) {
      throw new Error("A session is required before uploading attachments");
    }
    const createdSessionId = await ensureSessionId();
    activeSessionIdRef.current = createdSessionId;
    setActiveSessionId(createdSessionId);
    return createdSessionId;
  }, [ensureSessionId]);

  const addFiles = useCallback(
    (files: File[]) => {
      for (const file of files) {
        const fileId = generateUUID();
        const abortController = new AbortController();
        abortControllersRef.current.set(fileId, abortController);

        setUploadProgress((prev) => [
          ...prev,
          {
            fileId,
            fileName: file.name,
            bytesUploaded: 0,
            totalBytes: file.size,
            percent: 0,
          },
        ]);

        const uploadPromise = (async () => {
          try {
            const targetSessionId = await resolveSessionId();
            const uploaded = await api.uploadAttachment(projectId, targetSessionId, file, {
              signal: abortController.signal,
              onProgress: (bytesUploaded, totalBytes) => {
                setUploadProgress((prev) =>
                  prev.map((progress) =>
                    progress.fileId === fileId
                      ? {
                          ...progress,
                          bytesUploaded,
                          totalBytes,
                          percent:
                            totalBytes > 0 ? Math.round((bytesUploaded / totalBytes) * 100) : 0,
                        }
                      : progress,
                  ),
                );
              },
            });
            setAttachments((prev) => [...prev, uploaded]);
            return uploaded;
          } catch (error) {
            if (!abortController.signal.aborted) {
              onUploadError?.({
                fileId,
                fileName: file.name,
                message: error instanceof Error ? error.message : "Upload failed",
              });
            }
            return null;
          } finally {
            setUploadProgress((prev) => prev.filter((progress) => progress.fileId !== fileId));
            pendingUploadsRef.current.delete(fileId);
            abortControllersRef.current.delete(fileId);
          }
        })();

        pendingUploadsRef.current.set(fileId, uploadPromise);
      }
    },
    [onUploadError, projectId, resolveSessionId],
  );

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((attachment) => attachment.id !== id));
  }, []);

  const cancelUpload = useCallback((fileId: string) => {
    abortControllersRef.current.get(fileId)?.abort();
  }, []);

  const waitForUploads = useCallback(async () => {
    const pendingUploads = [...pendingUploadsRef.current.values()];
    if (pendingUploads.length > 0) {
      await Promise.all(pendingUploads);
    }
    return attachmentsRef.current;
  }, []);

  const clearAttachments = useCallback(() => {
    setAttachments([]);
  }, []);

  const restoreSnapshot = useCallback((snapshot: AttachmentUploadSnapshot) => {
    setAttachments(snapshot.attachments);
    setUploadProgress(snapshot.uploadProgress);
  }, []);

  const snapshot = useCallback(
    (): AttachmentUploadSnapshot => ({
      attachments: attachmentsRef.current,
      uploadProgress,
    }),
    [uploadProgress],
  );

  return {
    activeSessionId,
    attachments,
    uploadProgress,
    hasAttachments: attachments.length > 0 || uploadProgress.length > 0,
    hasPendingUploads: pendingUploadsRef.current.size > 0,
    addFiles,
    removeAttachment,
    cancelUpload,
    waitForUploads,
    clearAttachments,
    restoreSnapshot,
    snapshot,
  };
}
