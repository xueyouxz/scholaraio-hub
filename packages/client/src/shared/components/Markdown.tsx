import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { createMathPlugin } from "@streamdown/math";
import { type ReactNode, useContext } from "react";
import { Link } from "react-router-dom";
import {
  type Components,
  type ControlsConfig,
  Streamdown,
  defaultRemarkPlugins,
  defaultUrlTransform,
} from "streamdown";
import "katex/dist/katex.min.css";
import { FileLinkContext, fileLinkOf, remarkFileLinks } from "./fileLinks";

const plugins = { cjk, code, math: createMathPlugin({ singleDollarTextMath: true }) };
const remarkPlugins = [...Object.values(defaultRemarkPlugins), remarkFileLinks];

/**
 * Only what reading needs: code keeps its copy button, a diagram its copy and
 * fullscreen. Nothing downloads, and tables carry no toolbar.
 */
const CONTROLS: ControlsConfig = {
  code: { copy: true, download: false },
  table: false,
  mermaid: { copy: true, download: false, fullscreen: true, panZoom: true },
  image: false,
};

/**
 * A paper opens in the library, a file in the session's viewer; anything else
 * is a web page in a new tab.
 */
function MarkdownLink({ href, children }: { href?: string; children?: ReactNode }) {
  const openFile = useContext(FileLinkContext);
  if (href?.startsWith("/library/"))
    return (
      <Link className="text-primary underline" to={href}>
        {children}
      </Link>
    );
  const file = fileLinkOf(href);
  if (file) {
    if (!openFile) return <span>{children}</span>;
    const range = file.line ? `:${file.line}${file.endLine ? `-${file.endLine}` : ""}` : "";
    return (
      <button
        type="button"
        className="file-link"
        title={`${file.path}${range}`}
        onClick={() => openFile(file)}
      >
        {children}
      </button>
    );
  }
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className="text-primary underline">
      {children}
    </a>
  );
}

const components: Components = {
  a: ({ href, children }) => <MarkdownLink href={href}>{children}</MarkdownLink>,
};

export function Markdown({
  text,
  streaming = false,
  className = "min-w-0 break-words text-sm leading-7",
  controls = CONTROLS,
  lineNumbers = false,
}: {
  text: string;
  streaming?: boolean;
  className?: string;
  /** Streamdown's block controls; copy only, by default. */
  controls?: ControlsConfig;
  /** Number code lines; a fence's `startLine=N` / `noLineNumbers` still decides per block. */
  lineNumbers?: boolean;
}) {
  return (
    <Streamdown
      plugins={plugins}
      remarkPlugins={remarkPlugins}
      components={components}
      mode={streaming ? "streaming" : "static"}
      isAnimating={streaming}
      caret={streaming ? "block" : undefined}
      className={className}
      controls={controls}
      lineNumbers={lineNumbers}
      // Blocks show whole: the app hides scrollbars, so an inner scroll would hide
      // what they hold. Tool output caps its own height (session-markdown.css).
      codeBlockMaxHeight={0}
      tableMaxHeight={0}
      disallowedElements={["script", "iframe", "object", "embed", "form", "input"]}
      urlTransform={defaultUrlTransform}
    >
      {text}
    </Streamdown>
  );
}
