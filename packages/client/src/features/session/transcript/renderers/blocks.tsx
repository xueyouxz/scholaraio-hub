import { useState } from "react";
import { Markdown } from "../../../../shared/components/Markdown";

/** Names Shiki does not guess from an extension. */
const LANGUAGE_BY_NAME: Record<string, string> = {
  dockerfile: "dockerfile",
  makefile: "makefile",
  "cmakelists.txt": "cmake",
};

/** The highlighting language for a path, from its name or extension; "text" when unknown. */
export function languageOf(path: string): string {
  const name = path.split(/[\\/]/).pop()?.toLowerCase() ?? "";
  if (LANGUAGE_BY_NAME[name]) return LANGUAGE_BY_NAME[name];
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1) : "text";
}

/** A fence longer than any backtick run in the code, so the code cannot close it. */
function fence(text: string, info: string): string {
  const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const marks = "`".repeat(longest + 1);
  return `${marks}${info}\n${text}\n${marks}`;
}

/**
 * A tool's code or output, highlighted by Streamdown's Shiki plugin like code
 * in the answer itself. Long content is clipped until the reader asks for all
 * of it; failures stay plain and red.
 */
export function CodeBlock({
  text,
  language = "text",
  error = false,
  startLine,
  maxLines = 40,
}: {
  text: string;
  language?: string;
  error?: boolean;
  /** Show line numbers starting here. */
  startLine?: number;
  maxLines?: number;
}) {
  const [showAll, setShowAll] = useState(false);
  const lines = text.replace(/\n$/, "").split("\n");
  const clipped = !showAll && lines.length > maxLines;
  const visible = (clipped ? lines.slice(0, maxLines) : lines).join("\n");
  const info = startLine === undefined ? language : `${language} startLine=${startLine}`;
  return (
    <div className="tool-code">
      {error ? (
        <pre className="code-block code-block-error">
          <code>{visible}</code>
        </pre>
      ) : (
        <Markdown
          text={fence(visible, info)}
          className="session-markdown tool-markdown"
          lineNumbers={startLine !== undefined}
        />
      )}
      {clipped ? (
        <button type="button" className="show-more-btn" onClick={() => setShowAll(true)}>
          Show all {lines.length} lines
        </button>
      ) : null}
    </div>
  );
}

/** The last few lines of output, the way a terminal shows a running command. */
export function OutputTail({
  text,
  lines = 4,
  error = false,
}: {
  text: string;
  lines?: number;
  error?: boolean;
}) {
  const all = text.replace(/\n$/, "").split("\n");
  if (!text.trim()) return null;
  const hidden = all.length - lines;
  return (
    <div className="bash-collapsed-preview">
      {hidden > 0 ? <div className="bash-preview-truncated">… {hidden} more lines</div> : null}
      <pre className={`bash-preview-output${error ? " bash-preview-error" : ""}`}>
        {all.slice(-lines).join("\n")}
      </pre>
    </div>
  );
}

const MARKDOWN_LANGUAGES = new Set(["md", "markdown", "mdx"]);

/** Whether a highlighting language is Markdown, which reads better rendered. */
export const isMarkdown = (language: string) => MARKDOWN_LANGUAGES.has(language);

/**
 * A file's text as a call read or wrote it. Markdown is shown rendered, with
 * a switch to its source; everything else is highlighted code.
 */
export function FileContent({
  path,
  text,
  startLine,
}: {
  path: string;
  text: string;
  /** Number the lines from here; unset for text that carries no line of its own to start at. */
  startLine?: number;
}) {
  const language = languageOf(path);
  const [source, setSource] = useState(false);
  if (!isMarkdown(language))
    return <CodeBlock text={text} language={language} startLine={startLine} />;
  return (
    <div className="file-markdown">
      <fieldset className="file-markdown-toggle" aria-label="显示方式">
        <button type="button" aria-pressed={!source} onClick={() => setSource(false)}>
          预览
        </button>
        <button type="button" aria-pressed={source} onClick={() => setSource(true)}>
          源码
        </button>
      </fieldset>
      {source ? (
        <CodeBlock text={text} language={language} startLine={startLine} />
      ) : (
        <div className="file-markdown-preview">
          <Markdown text={text} className="session-markdown" />
        </div>
      )}
    </div>
  );
}

/** The full path of the file a call worked on, above what it shows of it. */
export function FilePath({ path }: { path: string }) {
  return path ? <p className="tool-file-path">{path}</p> : null;
}

/** Lines added and removed, Git style. */
export function DiffStatsLabel({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="diff-stats">
      <span className="diff-added">+{added}</span>
      <span className="diff-removed">−{removed}</span>
    </span>
  );
}
