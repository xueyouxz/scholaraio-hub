import { FileText, Library, Loader2 } from "lucide-react";
import { useEffect, useRef } from "react";
import type { MentionOption } from "../model/mentions";

interface Props {
  options: MentionOption[];
  loading: boolean;
  activeIndex: number;
  onHover: (index: number) => void;
  onSelect: (option: MentionOption) => void;
}

/** The `@` menu: literature collections, then papers, each with what it is. */
export function MentionSuggestions({ options, loading, activeIndex, onHover, onSelect }: Props) {
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  useEffect(() => {
    optionRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);
  return (
    <div className="absolute bottom-full left-0 z-30 mb-2 w-[min(28rem,100%)] max-h-72 overflow-y-auto border border-outline-variant/20 rounded-xl bg-surface-container-lowest shadow-lg p-1">
      {options.map((option, index) => {
        const Icon = option.ref.kind === "collection" ? Library : FileText;
        return (
          <button
            key={`${option.ref.kind}:${option.ref.id}`}
            type="button"
            ref={(element) => {
              optionRefs.current[index] = element;
            }}
            onMouseEnter={() => onHover(index)}
            onClick={() => onSelect(option)}
            aria-selected={index === activeIndex}
            className={`w-full text-left flex items-start gap-2 px-3 py-2 rounded-lg transition-colors ${
              index === activeIndex ? "bg-surface-container" : "bg-transparent"
            }`}
          >
            <Icon
              size={13}
              aria-hidden="true"
              className={`mt-0.5 shrink-0 ${option.ref.kind === "collection" ? "text-primary" : "text-on-surface-variant"}`}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] text-on-surface">{option.label}</span>
              {option.detail ? (
                <span className="block truncate text-[10.5px] font-mono text-on-surface-variant">
                  {option.detail}
                </span>
              ) : null}
            </span>
          </button>
        );
      })}
      {options.length === 0 ? (
        <p className="flex items-center gap-2 px-3 py-2 text-xs text-on-surface-variant">
          {loading ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : null}
          {loading ? "查找中…" : "输入文献集合名称或论文关键词"}
        </p>
      ) : null}
    </div>
  );
}
