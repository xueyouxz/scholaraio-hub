import type { SessionAttachment } from "@scholaraio-hub/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { type AttachmentTarget, sessionApi } from "../../../../core/sessions";

export interface StagedAttachment {
  /** Local key; the server id is `attachment.id` once uploaded. */
  key: string;
  file: File;
  status: "uploading" | "uploaded" | "failed";
  /** 0–1 while uploading. */
  progress: number;
  attachment?: SessionAttachment;
  error?: string;
  /** Object URL for an image thumbnail; revoked when the item goes. */
  preview?: string;
}

interface Upload {
  controller: AbortController;
  done: Promise<SessionAttachment | undefined>;
}

let nextKey = 0;

/**
 * Files attached in the composer. Each one uploads as soon as it is added, so
 * typing and other controls never wait on it; sending waits only for uploads
 * still in flight. Removing a file aborts its upload or deletes it server-side.
 */
export function useStagedAttachments(target: AttachmentTarget) {
  const [items, setItems] = useState<StagedAttachment[]>([]);
  // Handlers read the latest list here; state updaters stay free of side effects.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  /** Settled upload outcomes by key, readable before the next render. */
  const outcomes = useRef(new Map<string, SessionAttachment | Error>());
  const uploads = useRef(new Map<string, Upload>());
  const previews = useRef(new Set<string>());
  const targetRef = useRef(target);
  targetRef.current = target;

  const update = useCallback((key: string, patch: Partial<StagedAttachment>) => {
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  }, []);

  const start = useCallback(
    (key: string, file: File) => {
      const controller = new AbortController();
      const done = sessionApi
        .uploadAttachment(
          targetRef.current,
          file,
          (progress) => update(key, { progress }),
          controller.signal,
        )
        .then((attachment) => {
          outcomes.current.set(key, attachment);
          update(key, { status: "uploaded", progress: 1, attachment });
          return attachment;
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return undefined;
          const failure = error instanceof Error ? error : new Error("Upload failed");
          outcomes.current.set(key, failure);
          update(key, { status: "failed", error: failure.message });
          return undefined;
        })
        .finally(() => {
          if (uploads.current.get(key)?.controller === controller) uploads.current.delete(key);
        });
      uploads.current.set(key, { controller, done });
    },
    [update],
  );

  const add = useCallback(
    (files: File[]) => {
      const added = files.map((file) => {
        const preview = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;
        if (preview) previews.current.add(preview);
        return {
          key: `attachment-${nextKey++}`,
          file,
          status: "uploading" as const,
          progress: 0,
          preview,
        };
      });
      setItems((current) => [...current, ...added]);
      for (const item of added) start(item.key, item.file);
    },
    [start],
  );

  const release = useCallback((item: StagedAttachment) => {
    if (!item.preview) return;
    URL.revokeObjectURL(item.preview);
    previews.current.delete(item.preview);
  }, []);

  const remove = useCallback(
    (key: string) => {
      const item = itemsRef.current.find((candidate) => candidate.key === key);
      if (!item) return;
      release(item);
      uploads.current.get(key)?.controller.abort();
      uploads.current.delete(key);
      const uploaded = outcomes.current.get(key);
      outcomes.current.delete(key);
      if (uploaded && !(uploaded instanceof Error)) {
        sessionApi
          .removeAttachment(targetRef.current, uploaded.id)
          .catch((error: unknown) => console.warn("Could not delete the uploaded file", error));
      }
      setItems((current) => current.filter((candidate) => candidate.key !== key));
    },
    [release],
  );

  const retry = useCallback(
    (key: string) => {
      const item = items.find((candidate) => candidate.key === key);
      if (!item || item.status !== "failed") return;
      outcomes.current.delete(key);
      update(key, { status: "uploading", progress: 0, error: undefined });
      start(key, item.file);
    },
    [items, start, update],
  );

  /**
   * The uploaded attachments once no upload is in flight. Rejects when any
   * file failed, so a message never goes out missing a file the user added.
   */
  const settle = useCallback(async (): Promise<SessionAttachment[]> => {
    await Promise.all([...uploads.current.values()].map((upload) => upload.done));
    const settled = itemsRef.current
      .map((item) => outcomes.current.get(item.key))
      .filter((outcome) => outcome !== undefined);
    if (settled.some((outcome) => outcome instanceof Error))
      throw new Error("An attachment failed to upload. Retry or remove it before sending.");
    return settled.filter((outcome): outcome is SessionAttachment => !(outcome instanceof Error));
  }, []);

  /** Forget the files after they were sent; they now belong to the message. */
  const clear = useCallback(() => {
    for (const item of itemsRef.current) release(item);
    outcomes.current.clear();
    setItems([]);
  }, [release]);

  // Closing the composer stops uploads and frees thumbnails; server-side drafts expire.
  useEffect(() => {
    const active = uploads.current;
    const urls = previews.current;
    return () => {
      for (const upload of active.values()) upload.controller.abort();
      active.clear();
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  return {
    items,
    add,
    remove,
    retry,
    settle,
    clear,
    failed: items.some((item) => item.status === "failed"),
  };
}
