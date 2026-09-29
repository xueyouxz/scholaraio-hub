import { type HighlightOptions, type HighlightResult, code } from "@streamdown/code";
import { useQuery } from "@tanstack/react-query";
import { Code2, Download, Loader2, X } from "lucide-react";
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { sessionFileQuery } from "../../../core/sessions";
import { Markdown } from "../../../shared/components/Markdown";
import { type FileLink, FileLinkContext, relativeTo } from "../../../shared/components/fileLinks";
import { CopyButton } from "./CopyButton";
import { isMarkdown, languageOf } from "./renderers/blocks";

/** Past this, a file shows as plain lines: highlighting it would hold up the page. */
const MAX_HIGHLIGHT_CHARS = 256 * 1024;

type Token = HighlightResult["tokens"][number][number];

/**
 * Lets the transcript's file links open the file over the session, where the
 * reader is, instead of navigating away. One file is shown at a time; a link
 * inside it replaces it.
 */
export function SessionFileLinks({
  sessionId,
  cwd,
  children,
}: {
  sessionId: string;
  cwd: string;
  children: ReactNode;
}) {
  const [file, setFile] = useState<FileLink>();
  return (
    <FileLinkContext.Provider value={setFile}>
      {children}
      {file ? (
        <FileViewerDialog
          sessionId={sessionId}
          cwd={cwd}
          file={file}
          onOpen={setFile}
          onClose={() => setFile(undefined)}
        />
      ) : null}
    </FileLinkContext.Provider>
  );
}

/** A path under the working directory, shown from there. */
function shownPath(path: string, cwd: string): string {
  const root = cwd.replace(/[\\/]+$/, "");
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const rangeOf = (file: FileLink) =>
  file.line ? `:${file.line}${file.endLine ? `-${file.endLine}` : ""}` : "";

/**
 * The linked file in a modal: its path and size above, its text below,
 * highlighted, with the linked lines marked and scrolled to. The native dialog
 * brings the focus trap, Escape and the inert page; a click beside it closes
 * it, since there is nothing here to lose.
 */
function FileViewerDialog({
  sessionId,
  cwd,
  file,
  onOpen,
  onClose,
}: {
  sessionId: string;
  cwd: string;
  file: FileLink;
  onOpen: (file: FileLink) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.showModal();
    // The dialog holds the page inert while it is open; closing it releases that.
    return () => element.close();
  }, []);
  const path = shownPath(file.path, cwd);
  return createPortal(
    <dialog
      ref={ref}
      aria-label={path}
      // A close event can arrive after the dialog was shown again (an effect
      // re-run closes and reopens it); only one that left it closed is the user's.
      onClose={() => {
        if (!ref.current?.open) onClose();
      }}
      className="hub-dialog file-viewer-dialog"
    >
      {/* The backdrop closes it on a click; the keyboard's way out is Escape or the close button. */}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        onClick={onClose}
        className="file-viewer-backdrop"
      />
      <FileView
        // Another file starts over: its own view mode, its own scroll.
        key={`${file.path}${rangeOf(file)}`}
        sessionId={sessionId}
        file={file}
        path={path}
        onOpen={onOpen}
        onClose={onClose}
      />
    </dialog>,
    document.body,
  );
}

function FileView({
  sessionId,
  file,
  path,
  onOpen,
  onClose,
}: {
  sessionId: string;
  file: FileLink;
  path: string;
  onOpen: (file: FileLink) => void;
  onClose: () => void;
}) {
  const query = useQuery(sessionFileQuery(sessionId, file.path));
  const language = languageOf(file.path);
  const markdown = isMarkdown(language);
  // A linked line is in the source, so a file linked at a line opens there.
  const [source, setSource] = useState(!markdown || !!file.line);
  const content = query.data?.content;
  const lines = useMemo(() => content?.replace(/\n$/, "").split("\n"), [content]);
  const body = query.isPending ? (
    <p className="file-viewer-status">
      <Loader2 size={16} aria-hidden="true" className="animate-spin" /> 加载中…
    </p>
  ) : query.isError ? (
    <p role="alert" className="file-viewer-status file-viewer-error">
      无法打开这个文件：{query.error.message}
    </p>
  ) : content === undefined || !lines ? (
    <div className="file-viewer-status">
      <p>二进制文件无法在这里预览。</p>
      <a className="file-viewer-download" href={query.data.rawUrl} download>
        <Download size={14} aria-hidden="true" /> 下载文件
      </a>
    </div>
  ) : source ? (
    <FileLines
      text={content}
      lines={lines}
      language={language}
      line={file.line}
      endLine={file.endLine}
    />
  ) : (
    // Links in a document are written relative to where it is.
    <FileLinkContext.Provider value={(link) => onOpen(relativeTo(file.path, link))}>
      <div className="file-viewer-markdown">
        <Markdown text={content} className="session-markdown" />
      </div>
    </FileLinkContext.Provider>
  );
  return (
    <section className="file-viewer">
      <header className="file-viewer-header">
        <div className="file-viewer-info">
          <span className="file-viewer-path" title={file.path}>
            {path}
            {file.line ? <span className="file-viewer-range">{rangeOf(file)}</span> : null}
          </span>
          {query.data ? (
            <span className="file-viewer-meta">
              {formatSize(query.data.size)}
              {lines ? ` · ${lines.length} 行` : ""}
            </span>
          ) : null}
        </div>
        <div className="file-viewer-actions">
          {markdown && content !== undefined ? (
            <button
              type="button"
              className="message-action"
              aria-pressed={source}
              onClick={() => setSource((shown) => !shown)}
              title="显示源码"
              aria-label="显示源码"
            >
              <Code2 size={14} aria-hidden="true" />
            </button>
          ) : null}
          {content !== undefined ? <CopyButton text={content} label="复制内容" /> : null}
          {query.data ? (
            <a
              className="message-action"
              href={query.data.rawUrl}
              download
              title="下载"
              aria-label="下载"
            >
              <Download size={14} aria-hidden="true" />
            </a>
          ) : null}
          <button
            type="button"
            className="message-action"
            onClick={onClose}
            title="关闭"
            aria-label="关闭"
          >
            <X size={15} aria-hidden="true" />
          </button>
        </div>
      </header>
      <div className="file-viewer-body">
        {body}
        {query.data?.truncated && content !== undefined ? (
          <p className="file-viewer-truncated">文件较大，只显示前 1 MB。</p>
        ) : null}
      </div>
    </section>
  );
}

/** Shiki's tokens for the text, once highlighted; undefined until then or for text too long. */
function useTokens(text: string, language: string): Token[][] | undefined {
  const [result, setResult] = useState<{ text: string; tokens: Token[][] }>();
  useEffect(() => {
    const options = {
      code: text,
      language: language as HighlightOptions["language"],
      themes: code.getThemes(),
    };
    if (text.length > MAX_HIGHLIGHT_CHARS || !code.supportsLanguage(options.language)) return;
    let current = true;
    const done = (highlighted: HighlightResult) => {
      if (current) setResult({ text, tokens: highlighted.tokens });
    };
    const cached = code.highlight(options, done);
    if (cached) done(cached);
    return () => {
      current = false;
    };
  }, [text, language]);
  return result?.text === text ? result.tokens : undefined;
}

/** A file's lines, numbered, with the linked range marked and scrolled into view. */
function FileLines({
  text,
  lines,
  language,
  line,
  endLine,
}: {
  text: string;
  lines: string[];
  language: string;
  line?: number;
  endLine?: number;
}) {
  const tokens = useTokens(text, language);
  const target = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    target.current?.scrollIntoView({ block: "center" });
  }, []);
  const gutter = `${String(lines.length).length}ch`;
  const last = endLine ?? line;
  return (
    <div className="file-lines">
      {lines.map((content, index) => {
        const number = index + 1;
        const marked = line !== undefined && last !== undefined && number >= line && number <= last;
        return (
          <div
            // The lines of one text never move; their number is who they are.
            key={number}
            ref={number === line ? target : undefined}
            className="file-line"
            data-marked={marked || undefined}
          >
            <span className="file-line-number" style={{ width: gutter }} aria-hidden="true">
              {number}
            </span>
            <span className="file-line-text">
              {tokens?.[index]?.length
                ? tokens[index].map((token) => (
                    <span
                      key={token.offset}
                      style={{ color: token.htmlStyle?.color ?? token.color }}
                    >
                      {token.content}
                    </span>
                  ))
                : content || " "}
            </span>
          </div>
        );
      })}
    </div>
  );
}
