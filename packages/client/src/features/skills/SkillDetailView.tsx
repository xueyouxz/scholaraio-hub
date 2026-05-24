import "katex/dist/katex.min.css";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy, Send } from "lucide-react";
import { memo, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { api } from "../../core/api";
import { queryKeys } from "../../core/queryKeys";

interface Props {
  skillName: string;
}

export function SkillDetailView({ skillName }: Props) {
  const detailQuery = useQuery({
    queryKey: queryKeys.scholaraioSkill(skillName),
    queryFn: ({ signal }) => api.getScholaraioSkill(skillName, { signal }),
    staleTime: Number.POSITIVE_INFINITY,
  });

  const [copied, setCopied] = useState(false);

  if (detailQuery.isLoading) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-on-surface-variant">
        加载中…
      </div>
    );
  }

  if (detailQuery.isError || !detailQuery.data) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-error">
        无法加载 skill 详情。
      </div>
    );
  }

  const skill = detailQuery.data;
  const slashCommand = `/${skill.name}`;

  return (
    <article className="max-w-3xl mx-auto px-8 py-8">
      <header className="mb-6 pb-6 border-b border-outline-variant">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="font-serif text-2xl font-bold text-on-surface">{skill.name}</h1>
            <p className="mt-2 text-sm text-on-surface-variant leading-relaxed">
              {skill.description}
            </p>
            <div className="mt-3 flex items-center gap-2">
              <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-sans uppercase tracking-wider">
                {skill.source}
              </span>
              <span className="px-2 py-0.5 rounded-full bg-surface-container text-on-surface-variant text-[10px] font-sans uppercase tracking-wider">
                {skill.category}
              </span>
            </div>
          </div>
          <div className="flex flex-col gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(slashCommand).then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1500);
                });
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface text-xs font-sans"
            >
              {copied ? (
                <Check className="w-3.5 h-3.5 text-primary" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              复制 {slashCommand}
            </button>
            <button
              type="button"
              disabled
              title="请先打开一个会话，然后在输入框中使用 / 调用此 skill"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-container text-on-surface-variant text-xs font-sans opacity-50 cursor-not-allowed"
            >
              <Send className="w-3.5 h-3.5" />
              插入到会话
            </button>
          </div>
        </div>
        <div className="mt-4 font-mono text-[10px] text-on-surface-variant/70 break-all">
          {skill.path}
        </div>
      </header>
      <SkillMarkdown content={skill.body} />
    </article>
  );
}

const SkillMarkdown = memo(function SkillMarkdown({ content }: { content: string }) {
  return (
    <div className="skill-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false }]]}
        components={{
          h1: ({ children }) => (
            <h1 className="font-serif text-xl font-bold text-on-surface mt-8 mb-3 first:mt-0">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="font-serif text-lg font-bold text-on-surface mt-7 mb-2.5">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="font-serif text-base font-semibold text-on-surface mt-6 mb-2">
              {children}
            </h3>
          ),
          p: ({ children }) => (
            <p className="text-sm text-on-surface leading-relaxed mb-3">{children}</p>
          ),
          ul: ({ children }) => (
            <ul className="list-disc pl-6 mb-3 space-y-1 text-sm text-on-surface">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal pl-6 mb-3 space-y-1 text-sm text-on-surface">{children}</ol>
          ),
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          code: ({ className, children }) => {
            const isInline = !className;
            if (isInline) {
              return (
                <code className="px-1 py-0.5 rounded bg-surface-container font-mono text-[12px] text-primary">
                  {children}
                </code>
              );
            }
            return <code className={`${className} font-mono text-[12px]`}>{children}</code>;
          },
          pre: ({ children }) => (
            <pre className="bg-surface-container rounded-lg p-3 overflow-x-auto mb-3 text-[12px]">
              {children}
            </pre>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-4 border-outline-variant pl-3 italic text-on-surface-variant mb-3">
              {children}
            </blockquote>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto mb-3">
              <table className="min-w-full text-sm border-collapse">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-outline-variant px-2 py-1 bg-surface-container font-semibold text-left">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-outline-variant px-2 py-1">{children}</td>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-2 hover:opacity-80"
            >
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
