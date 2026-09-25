import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { createMathPlugin } from "@streamdown/math";
import { Link } from "react-router-dom";
import { type Components, type ControlsConfig, Streamdown, defaultUrlTransform } from "streamdown";
import "katex/dist/katex.min.css";

const plugins = { cjk, code, math: createMathPlugin({ singleDollarTextMath: true }) };
const components: Components = {
  a: ({ href, children }) =>
    href?.startsWith("/library/") ? (
      <Link className="text-primary underline" to={href}>
        {children}
      </Link>
    ) : (
      <a href={href} target="_blank" rel="noreferrer noopener" className="text-primary underline">
        {children}
      </a>
    ),
};
export function Markdown({
  text,
  streaming = false,
  className = "min-w-0 break-words text-sm leading-7",
  controls,
}: {
  text: string;
  streaming?: boolean;
  className?: string;
  /** Streamdown's block controls (copy, download…); its defaults when unset. */
  controls?: ControlsConfig;
}) {
  return (
    <Streamdown
      plugins={plugins}
      components={components}
      mode={streaming ? "streaming" : "static"}
      isAnimating={streaming}
      caret={streaming ? "block" : undefined}
      className={className}
      controls={controls}
      disallowedElements={["script", "iframe", "object", "embed", "form", "input"]}
      urlTransform={defaultUrlTransform}
    >
      {text}
    </Streamdown>
  );
}
