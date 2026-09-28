import type { SessionAttachment } from "@scholaraio-hub/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { type AttachmentTarget, sessionApi } from "../../../../core/sessions";
import { type AttachmentKind, attachmentKind } from "../../lib/fileKinds";

export interface StagedAttachment {
  /** Local key; the server id is `attachment.id` once uploaded. */
  key: string;
  name: string;
  mediaType: string;
  /** The local file while it is new; a file the corrected message already carried has none. */
  file?: File;
  /** Carried by the sent message being corrected: removing it never deletes the upload. */
  sent?: boolean;
  kind: AttachmentKind;
  status: "uploading" | "uploaded" | "failed";
  /** 0–1 while uploading. */
  progress: number;
  attachment?: SessionAttachment;
  error?: string;
  /**
   * Image or video thumbnail: an object URL for a new file (revoked when the
   * item goes), the upload's own URL for a file already sent.
   */
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
 * still in flight. Removing a new file aborts its upload or deletes it
 * server-side; a file the corrected message already carried only leaves the tray.
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
        const kind = attachmentKind(file);
        const preview =
          kind === "image" || kind === "video" ? URL.createObjectURL(file) : undefined;
        if (preview) previews.current.add(preview);
        return {
          key: `attachment-${nextKey++}`,
          name: file.name,
          mediaType: file.type,
          file,
          kind,
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

  /**
   * Put files a sent message carried back in the tray, as uploaded. While that
   * message still stands (it is being corrected) they are `sent`: removing one
   * leaves the upload alone. Once it was taken back they are plain drafts again.
   */
  const adopt = useCallback((attachments: SessionAttachment[], sent: boolean) => {
    const adopted = attachments.map((attachment): StagedAttachment => {
      const key = `attachment-${nextKey++}`;
      outcomes.current.set(key, attachment);
      const name = attachment.filename || "附件";
      const kind = attachmentKind({ name, type: attachment.mediaType });
      return {
        key,
        name,
        mediaType: attachment.mediaType,
        sent,
        kind,
        status: "uploaded",
        progress: 1,
        attachment,
        preview: kind === "image" || kind === "video" ? attachment.url : undefined,
      };
    });
    setItems((current) => [...current, ...adopted]);
  }, []);

  const release = useCallback((item: StagedAttachment) => {
    // Only object URLs are ours to free; a sent file's thumbnail is its own URL.
    if (!item.preview || !previews.current.has(item.preview)) return;
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
      if (uploaded && !(uploaded instanceof Error) && !item.sent) {
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
      if (!item?.file || item.status !== "failed") return;
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

  /**
   * Take the files out of the tray as their message goes out. The message is
   * shown at once, before the send settles: `commit` forgets them once sent (they
   * now belong to the message), `restore` puts them back when the send failed.
   */
  const take = useCallback(() => {
    const taken = itemsRef.current;
    itemsRef.current = [];
    setItems([]);
    return {
      commit: () => {
        for (const item of taken) {
          release(item);
          outcomes.current.delete(item.key);
        }
      },
      restore: () => setItems((current) => [...taken, ...current]),
    };
  }, [release]);

  /**
   * Put `next` in the tray and return what it held, to set a draft's files
   * aside while a sent message is corrected. Nothing is uploaded, deleted or
   * freed; an upload that finished while set aside shows as done.
   */
  const swap = useCallback((next: StagedAttachment[]) => {
    const previous = itemsRef.current;
    const shown = next.map((item) => {
      const outcome = outcomes.current.get(item.key);
      if (!outcome || item.status !== "uploading") return item;
      return outcome instanceof Error
        ? { ...item, status: "failed" as const, error: outcome.message }
        : { ...item, status: "uploaded" as const, progress: 1, attachment: outcome };
    });
    itemsRef.current = shown;
    setItems(shown);
    return previous;
  }, []);

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
    adopt,
    swap,
    remove,
    retry,
    settle,
    take,
    failed: items.some((item) => item.status === "failed"),
  };
}
