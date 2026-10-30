import { FileVideo, Play } from "lucide-react";
import { useState } from "react";
import { AttachmentViewer } from "./AttachmentViewer";
import { FileKindIcon } from "./FileKindIcon";
import { attachmentKind, fileExtension } from "./fileKinds";

/**
 * A file in the transcript that is not a picture: a video shows its first
 * frame, anything else its kind's icon and its name. Either opens the viewer.
 */
export function FileAttachment({
  url,
  filename,
  mediaType,
}: {
  url: string;
  filename?: string;
  mediaType: string;
}) {
  const [open, setOpen] = useState(false);
  const name = filename || "附件";
  const kind = attachmentKind({ name, type: mediaType });
  return (
    <>
      {kind === "video" ? (
        <button
          type="button"
          title={name}
          aria-label={`查看视频 ${name}`}
          onClick={() => setOpen(true)}
          className="relative block h-28 w-44 shrink-0 cursor-pointer overflow-hidden rounded-[5px] border border-outline-variant/20 bg-surface-container p-0"
        >
          {/* Shows through when the browser cannot decode a frame of this video. */}
          <FileVideo
            size={24}
            aria-hidden="true"
            className="absolute inset-0 m-auto text-on-surface-variant/60"
          />
          {/* A muted, paused video shows its first frame; `#t` makes Safari load one. */}
          <video
            src={`${url}#t=0.1`}
            muted
            playsInline
            preload="metadata"
            tabIndex={-1}
            className="pointer-events-none relative size-full object-cover"
          />
          <span className="absolute bottom-1.5 left-1.5 flex size-5 items-center justify-center rounded-full bg-black/55 text-white">
            <Play size={11} aria-hidden="true" className="ml-px fill-current" />
          </span>
        </button>
      ) : (
        <button
          type="button"
          title={name}
          data-kind={kind}
          onClick={() => setOpen(true)}
          className="flex h-14 w-56 max-w-full shrink-0 cursor-pointer items-center gap-2.5 rounded-lg border border-outline-variant/20 bg-surface-container-low px-2 transition-colors hover:bg-surface-container"
        >
          <FileKindIcon kind={kind} />
          <span className="min-w-0 flex-1 text-left">
            <span className="block truncate text-xs font-medium text-on-surface">{name}</span>
            <span className="mt-0.5 block truncate text-[10px] uppercase tracking-wide text-on-surface-variant">
              {fileExtension(name) || "file"}
            </span>
          </span>
        </button>
      )}
      {open ? (
        <AttachmentViewer file={{ name, mediaType, source: url }} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}
