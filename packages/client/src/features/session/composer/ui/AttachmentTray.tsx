import { FileVideo, Loader2, Play, RotateCw, X } from "lucide-react";
import { useState } from "react";
import { AttachmentViewer } from "../../attachments/AttachmentViewer";
import { FileKindIcon } from "../../attachments/FileKindIcon";
import { fileExtension } from "../../attachments/fileKinds";
import type { StagedAttachment } from "../hooks/useStagedAttachments";

type TrayActions = {
  disabled?: boolean;
  onRemove: (key: string) => void;
  onRetry: (key: string) => void;
};

type TileProps = { item: StagedAttachment; onView: () => void } & TrayActions;

/** Shown while the pointer is on the tile, or focused; always on touch screens. */
const HOVER_ONLY =
  "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100";

/**
 * The files a message will carry, above the text box: pictures and videos as
 * thumbnails, other files as an icon for their kind and their name. Each shows
 * its own upload state, opens in the file viewer, and can be removed on hover.
 */
export function AttachmentTray({ items, ...actions }: { items: StagedAttachment[] } & TrayActions) {
  const [viewing, setViewing] = useState<string>();
  const viewed = items.find((item) => item.key === viewing);
  if (items.length === 0) return null;
  return (
    <>
      <ul className="flex gap-2 overflow-x-auto px-3 pt-3 pb-1" aria-label="Attachments">
        {items.map((item) => {
          const Tile = item.preview ? MediaTile : FileTile;
          return (
            <Tile key={item.key} item={item} onView={() => setViewing(item.key)} {...actions} />
          );
        })}
      </ul>
      {viewed ? (
        <AttachmentViewer
          file={{
            name: viewed.name,
            mediaType: viewed.mediaType,
            source: viewed.file ?? viewed.attachment?.url ?? "",
          }}
          onClose={() => setViewing(undefined)}
        />
      ) : null}
    </>
  );
}

function MediaTile({ item, onView, ...actions }: TileProps) {
  const failed = item.status === "failed";
  return (
    <li
      data-status={item.status}
      aria-label={item.name}
      title={item.error ?? item.name}
      className={`group relative size-16 shrink-0 overflow-hidden rounded-lg border bg-surface-container ${
        failed ? "border-error/60" : "border-outline-variant/20"
      }`}
    >
      {item.kind === "video" ? (
        <>
          {/* Shows through when the browser cannot decode a frame of this video. */}
          <FileVideo
            size={22}
            aria-hidden="true"
            className="absolute inset-0 m-auto text-on-surface-variant/60"
          />
          {/* A muted, paused video shows its first frame; `#t` makes Safari load one. */}
          <video
            src={`${item.preview}#t=0.1`}
            muted
            playsInline
            preload="metadata"
            tabIndex={-1}
            className="relative size-full object-cover"
          />
          <span className="absolute bottom-1 left-1 flex size-4 items-center justify-center rounded-full bg-black/55 text-white">
            <Play size={9} aria-hidden="true" className="ml-px fill-current" />
          </span>
        </>
      ) : (
        <img src={item.preview} alt="" className="size-full object-cover" />
      )}
      <button
        type="button"
        onClick={onView}
        aria-label={`View ${item.name}`}
        className="absolute inset-0 cursor-zoom-in"
      />
      <UploadState item={item} {...actions} overlay />
      <RemoveButton item={item} {...actions} />
    </li>
  );
}

function FileTile({ item, onView, ...actions }: TileProps) {
  const failed = item.status === "failed";
  const extension = fileExtension(item.name);
  return (
    <li
      data-status={item.status}
      data-kind={item.kind}
      aria-label={item.name}
      title={item.error ?? item.name}
      className={`group relative h-16 w-52 shrink-0 overflow-hidden rounded-lg border bg-surface-container ${
        failed ? "border-error/60" : "border-outline-variant/20"
      }`}
    >
      <button
        type="button"
        onClick={onView}
        aria-label={`View ${item.name}`}
        className="flex size-full items-center gap-2.5 pl-2 pr-6 text-left"
      >
        <FileKindIcon kind={item.kind} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium text-on-surface">{item.name}</span>
          <span
            className={`mt-0.5 block truncate text-[10px] uppercase tracking-wide ${
              failed ? "text-error" : "text-on-surface-variant"
            }`}
          >
            {failed ? "Upload failed" : extension || "file"}
          </span>
        </span>
      </button>
      <UploadState item={item} {...actions} />
      <RemoveButton item={item} {...actions} />
    </li>
  );
}

/** The spinner and progress bar while uploading, a retry button once it failed. */
function UploadState({
  item,
  disabled,
  onRetry,
  overlay = false,
}: { item: StagedAttachment; overlay?: boolean } & Omit<TrayActions, "onRemove">) {
  if (item.status === "uploaded") return null;
  if (item.status === "failed") {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => onRetry(item.key)}
        aria-label={`Retry upload of ${item.name}`}
        className={
          overlay
            ? "absolute inset-0 flex items-center justify-center bg-black/45 text-white hover:bg-black/55 transition-colors"
            : "absolute right-1.5 bottom-1.5 p-0.5 rounded text-error hover:bg-error/10 transition-colors"
        }
      >
        <RotateCw size={overlay ? 16 : 12} />
      </button>
    );
  }
  return (
    <>
      {overlay ? (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/35 text-white">
          <Loader2 size={16} aria-label="Uploading" className="animate-spin" />
        </span>
      ) : (
        <Loader2
          size={12}
          aria-label="Uploading"
          className="pointer-events-none absolute right-1.5 bottom-1.5 animate-spin text-on-surface-variant"
        />
      )}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-0 bottom-0 h-0.5 bg-primary transition-[width]"
        style={{ width: `${Math.round(item.progress * 100)}%` }}
      />
    </>
  );
}

function RemoveButton({
  item,
  disabled,
  onRemove,
}: { item: StagedAttachment } & Omit<TrayActions, "onRetry">) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onRemove(item.key)}
      aria-label={`Remove ${item.name}`}
      className={`absolute top-1 right-1 flex size-5 items-center justify-center rounded-full bg-black/60 text-white hover:bg-error transition-[opacity,background-color] disabled:hidden ${HOVER_ONLY}`}
    >
      <X size={12} strokeWidth={2.5} />
    </button>
  );
}
