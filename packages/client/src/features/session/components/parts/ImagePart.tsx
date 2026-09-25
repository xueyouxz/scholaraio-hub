import { useState } from "react";
import type { IndexedPart } from "../../lib/activity";
import type { PartOf } from "../../lib/parts";

type FilePart = PartOf<"file">;

/** One picture: a thumbnail that opens to full width, and back, on click. */
export function ImageThumb({ url, name }: { url: string; name?: string }) {
  const [large, setLarge] = useState(false);
  return (
    <button
      type="button"
      className={`image-thumb${large ? " large" : ""}`}
      aria-label={large ? `缩小图片 ${name ?? ""}` : `放大图片 ${name ?? ""}`}
      aria-pressed={large}
      onClick={() => setLarge((value) => !value)}
    >
      <img src={url} alt={name ?? ""} loading="lazy" />
    </button>
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
