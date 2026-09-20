import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { createMathPlugin } from "@streamdown/math";
import { Link } from "react-router-dom";
import { type Components, Streamdown, defaultUrlTransform } from "streamdown";
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
  imageBase,
}: { text: string; streaming?: boolean; imageBase?: string }) {
  return (
    <Streamdown
      plugins={plugins}
      components={components}
      mode={streaming ? "streaming" : "static"}
      isAnimating={streaming}
      className="min-w-0 break-words text-sm leading-7"
      disallowedElements={["script", "iframe", "object", "embed", "form", "input"]}
      urlTransform={(url, key, node) => {
        if (node.tagName === "img" && imageBase && !/^(?:[a-z]+:|\/)/i.test(url)) {
          return imageBase + url.split("/").map(encodeURIComponent).join("/");
        }
        return defaultUrlTransform(url, key, node);
      }}
    >
      {text}
    </Streamdown>
  );
}
