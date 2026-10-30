/** What a file is, for showing it: a thumbnail for pictures and video, an icon otherwise. */
export type AttachmentKind =
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "document"
  | "spreadsheet"
  | "presentation"
  | "archive"
  | "code"
  | "text"
  | "file";

const EXTENSION_KINDS: Record<string, AttachmentKind> = {
  pdf: "pdf",
  doc: "document",
  docx: "document",
  odt: "document",
  rtf: "document",
  pages: "document",
  xls: "spreadsheet",
  xlsx: "spreadsheet",
  ods: "spreadsheet",
  csv: "spreadsheet",
  tsv: "spreadsheet",
  numbers: "spreadsheet",
  ppt: "presentation",
  pptx: "presentation",
  odp: "presentation",
  key: "presentation",
  zip: "archive",
  tar: "archive",
  gz: "archive",
  tgz: "archive",
  bz2: "archive",
  xz: "archive",
  "7z": "archive",
  rar: "archive",
  txt: "text",
  md: "text",
  markdown: "text",
  log: "text",
  tex: "text",
  bib: "text",
  js: "code",
  jsx: "code",
  ts: "code",
  tsx: "code",
  mjs: "code",
  cjs: "code",
  py: "code",
  ipynb: "code",
  r: "code",
  java: "code",
  kt: "code",
  go: "code",
  rs: "code",
  c: "code",
  h: "code",
  cpp: "code",
  hpp: "code",
  cs: "code",
  rb: "code",
  php: "code",
  swift: "code",
  sh: "code",
  sql: "code",
  json: "code",
  yaml: "code",
  yml: "code",
  toml: "code",
  xml: "code",
  html: "code",
  css: "code",
};

/** The file's extension, lower-cased, without the dot; empty when it has none. */
export function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** The kind by media type first, then by extension (browsers leave many types empty). */
export function attachmentKind(file: Pick<File, "name" | "type">): AttachmentKind {
  const type = file.type.toLowerCase();
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  if (type === "application/pdf") return "pdf";
  const byExtension = EXTENSION_KINDS[fileExtension(file.name)];
  if (byExtension) return byExtension;
  return type.startsWith("text/") ? "text" : "file";
}

/**
 * How the file viewer shows a kind. Pictures and video load from their URL;
 * a PDF and text are read first, so the viewer never frames a served file
 * (the server sends attachments as downloads, and a mislabelled one could run).
 */
export type ViewMode = "image" | "video" | "pdf" | "text" | "none";

export function viewMode(kind: AttachmentKind): ViewMode {
  if (kind === "image" || kind === "video" || kind === "pdf") return kind;
  return kind === "text" || kind === "code" ? "text" : "none";
}
