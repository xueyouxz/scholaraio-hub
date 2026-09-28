import { useState } from "react";
import type { IndexedPart } from "../../lib/activity";
import type { PartOf } from "../../lib/parts";
import { AttachmentViewer } from "../AttachmentViewer";

type FilePart = PartOf<"file">;

/**
 * One picture: a small thumbnail scaled to keep its proportions, which
 * opens full size in the file viewer, so the transcript never reflows.
 */
export function ImageThumb({ url, name }: { url: string; name?: string }) {
  const [open, setOpen] = useState(false);
  const label = name || "图片";
  return (
    <>
      <button
        type="button"
        className="image-thumb"
        aria-label={`查看图片 ${label}`}
        onClick={() => setOpen(true)}
      >
        <img src={url} alt={name ?? ""} loading="lazy" />
      </button>
      {open ? (
        <AttachmentViewer
          file={{ name: label, mediaType: "image/*", source: url }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

/**
 * Pictures side by side under the work that produced them, keyed by their
 * place in the message (data URLs are long and may repeat).
 */
export function ImageStrip({ images }: { images: IndexedPart<FilePart>[] }) {
  return (
    <div className="image-strip">
      {images.map(({ part, index }) => (
        <ImageThumb key={index} url={part.url} name={part.filename} />
      ))}
    </div>
  );
}
