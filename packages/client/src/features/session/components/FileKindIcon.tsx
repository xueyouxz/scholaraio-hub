import {
  FileArchive,
  FileAudio,
  FileCode,
  File as FileIcon,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileType,
  FileVideo,
  type LucideIcon,
  Presentation,
} from "lucide-react";
import type { AttachmentKind } from "../lib/fileKinds";

/** Each file kind's icon and its tile's tint, so kinds tell apart at a glance. */
const KIND_ICONS: Record<AttachmentKind, { icon: LucideIcon; tint: string }> = {
  image: { icon: FileImage, tint: "bg-primary/10 text-primary" },
  video: { icon: FileVideo, tint: "bg-primary/10 text-primary" },
  audio: { icon: FileAudio, tint: "bg-tertiary/10 text-tertiary" },
  pdf: { icon: FileType, tint: "bg-error/10 text-error" },
  document: { icon: FileText, tint: "bg-primary-container/15 text-primary-container" },
  spreadsheet: { icon: FileSpreadsheet, tint: "bg-secondary-container text-secondary" },
  presentation: { icon: Presentation, tint: "bg-tertiary-container/60 text-tertiary" },
  archive: { icon: FileArchive, tint: "bg-surface-container-highest text-on-surface-variant" },
  code: { icon: FileCode, tint: "bg-secondary/10 text-secondary" },
  text: { icon: FileText, tint: "bg-surface-container-highest text-on-surface-variant" },
  file: { icon: FileIcon, tint: "bg-surface-container-highest text-on-surface-variant" },
};

/** A file kind's icon on its tinted tile, the same in the composer and the transcript. */
export function FileKindIcon({ kind }: { kind: AttachmentKind }) {
  const { icon: Icon, tint } = KIND_ICONS[kind];
  return (
    <span className={`flex size-10 shrink-0 items-center justify-center rounded-md ${tint}`}>
      <Icon size={20} aria-hidden="true" />
    </span>
  );
}
