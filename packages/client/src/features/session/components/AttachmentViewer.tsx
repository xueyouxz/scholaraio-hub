import { Loader2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { type ViewMode, attachmentKind, viewMode } from "../lib/fileKinds";
import { FileKindIcon } from "./FileKindIcon";

/** Longer text shows its beginning. */
const MAX_TEXT_CHARS = 512 * 1024;

/** A file to look at: sent ones load from their URL, ones still in the composer are local. */
export interface ViewedFile {
  name: string;
  mediaType: string;
  source: string | Blob;
}

interface Loaded {
  /** What the image, video or PDF frame points at. */
  url?: string;
  text?: string;
  truncated?: boolean;
  error?: string;
}

/**
 * Where to show the file from. A local file gets an object URL; a PDF is read
 * into one typed as PDF, so the frame shows it whatever the server labelled it;
 * text is read to show as text. Object URLs are revoked when the viewer closes.
 */
function useLoadedFile(source: string | Blob, mode: ViewMode): Loaded {
  const [loaded, setLoaded] = useState<Loaded>({});
  useEffect(() => {
    if (mode === "none") return;
    const controller = new AbortController();
    const objectUrls: string[] = [];
    const createUrl = (blob: Blob) => {
      const url = URL.createObjectURL(blob);
      objectUrls.push(url);
      return url;
    };
    const read = async (): Promise<Response> => {
      if (typeof source !== "string") return new Response(source);
      const response = await fetch(source, { signal: controller.signal });
      if (!response.ok) throw new Error(`文件加载失败（${response.status}）`);
      return response;
    };
    const load = async (): Promise<Loaded> => {
      if (mode === "pdf") {
        const blob = await (await read()).blob();
        return { url: createUrl(new Blob([blob], { type: "application/pdf" })) };
      }
      const url = typeof source === "string" ? source : createUrl(source);
      if (mode !== "text") return { url };
      const text = await (await read()).text();
      return { url, text: text.slice(0, MAX_TEXT_CHARS), truncated: text.length > MAX_TEXT_CHARS };
    };
    setLoaded({});
    load().then(
      (next) => {
        if (!controller.signal.aborted) setLoaded(next);
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setLoaded({ error: error instanceof Error ? error.message : "文件加载失败" });
      },
    );
    return () => {
      controller.abort();
      for (const url of objectUrls) URL.revokeObjectURL(url);
    };
  }, [source, mode]);
  return loaded;
}

/**
 * A lightbox for one file: the file itself on a dark backdrop, with nothing
 * around it but a close control. Pictures, video, PDFs and text are shown;
 * other kinds say they cannot be. The native modal dialog brings the focus
 * trap, Escape and the inert page; a click beside the file also closes it,
 * since there is nothing here to lose.
 */
export function AttachmentViewer({ file, onClose }: { file: ViewedFile; onClose: () => void }) {
  const kind = attachmentKind({ name: file.name, type: file.mediaType });
  const mode = viewMode(kind);
  const loaded = useLoadedFile(file.source, mode);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.showModal();
    // The dialog holds the page inert while it is open; closing it releases that.
    return () => element.close();
  }, []);
  const body =
    mode === "none" ? (
      <div className="flex flex-col items-center gap-3 text-center text-white">
        <FileKindIcon kind={kind} />
        <p className="text-sm">{file.name}</p>
        <p className="text-xs text-white/70">此类文件无法在这里预览</p>
      </div>
    ) : loaded.error ? (
      <p role="alert" className="text-sm text-white">
        {loaded.error}
      </p>
    ) : !loaded.url ? (
      <Loader2 size={24} aria-label="加载中" className="animate-spin text-white/80" />
    ) : mode === "image" ? (
      <img
        src={loaded.url}
        alt={file.name}
        className="max-h-[calc(100dvh-7rem)] max-w-[calc(100vw-8rem)] object-contain"
      />
    ) : mode === "video" ? (
      // Starts muted so it may play at once; the controls turn the sound on.
      <video
        src={loaded.url}
        controls
        autoPlay
        muted
        playsInline
        className="max-h-[calc(100dvh-7rem)] max-w-[calc(100vw-8rem)]"
      />
    ) : mode === "pdf" ? (
      <iframe
        title={file.name}
        src={loaded.url}
        className="h-[calc(100dvh-7rem)] w-[min(calc(100vw-8rem),64rem)] border-0"
      />
    ) : (
      // Text needs a page to be read on; the page is the file, nothing more.
      <pre className="m-0 max-h-[calc(100dvh-7rem)] w-[min(calc(100vw-8rem),56rem)] overflow-auto whitespace-pre-wrap break-words bg-surface-container-lowest p-6 font-mono text-xs leading-relaxed text-on-surface">
        {loaded.text}
        {loaded.truncated ? "\n\n…" : null}
      </pre>
    );
  // Content keeps a 4rem gutter on each side, so the close control never covers it.
  // On the body, so the viewer is never part of the row that opened it.
  return createPortal(
    <dialog
      ref={ref}
      aria-label={file.name}
      data-view={mode}
      // A close event can arrive after the dialog was shown again (an effect
      // re-run closes and reopens it); only one that left it closed is the user's.
      onClose={() => {
        if (!ref.current?.open) onClose();
      }}
      className="attachment-viewer m-0 h-dvh max-h-none w-dvw max-w-none items-center justify-center border-0 bg-transparent p-0 open:flex"
    >
      {/* The backdrop closes it on a click; the keyboard's way out is Escape or the close button. */}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 cursor-default border-0 bg-transparent p-0"
      />
      <div className="relative">{body}</div>
      <button
        type="button"
        onClick={onClose}
        aria-label="关闭"
        className="fixed top-4 right-4 flex size-10 cursor-pointer items-center justify-center rounded-full border-0 bg-black/45 text-white transition-colors hover:bg-black/65 focus-visible:outline-2 focus-visible:outline-white"
      >
        <X size={20} aria-hidden="true" />
      </button>
    </dialog>,
    document.body,
  );
}
