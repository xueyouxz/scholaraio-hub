import { ChevronDown } from "lucide-react";
import type { ReactNode, Ref } from "react";
import { ChoiceMenu } from "../../../shared/ui/Menu";

/** The library service's search modes (`hub/search.py`), as every search box offers them. */
export const SEARCH_MODES = [
  { id: "unified", label: "综合", description: "关键词与向量检索融合排序" },
  { id: "keyword", label: "关键词", description: "标题、作者、摘要与全文中的字面匹配" },
  { id: "semantic", label: "语义", description: "按意思检索，基于向量相似度" },
  { id: "author", label: "作者", description: "按作者姓名查找" },
] as const;

export type SearchMode = (typeof SEARCH_MODES)[number]["id"];

/** A mode read from a link or saved state; anything else is `fallback`. */
export function searchMode(value: string | null | undefined, fallback: SearchMode): SearchMode {
  return SEARCH_MODES.find((item) => item.id === value)?.id ?? fallback;
}

const PLACEHOLDERS: Partial<Record<SearchMode, string>> = {
  semantic: "描述你要找的内容…",
  author: "作者姓名…",
};

const SIZES = {
  large: { trigger: "pl-4 pr-3 py-3", input: "px-3 py-3 text-sm" },
  compact: { trigger: "pl-3 pr-2 py-1.5", input: "px-2 py-1.5 text-[13px]" },
};

/**
 * A search box over the library: the mode, then the query. The caller frames
 * it (`className`), decides when a query runs (`onSubmit` on Enter, or as the
 * text settles) and adds what follows the field (`trailing`: a spinner, clear).
 */
export function LibrarySearchBar({
  mode,
  onModeChange,
  text,
  onTextChange,
  onSubmit,
  onEscape,
  label,
  placeholder,
  size,
  className,
  inputRef,
  leading,
  trailing,
}: {
  mode: SearchMode;
  onModeChange: (mode: SearchMode) => void;
  text: string;
  onTextChange: (text: string) => void;
  /** Enter in the field, unless it confirms an input method's composition. */
  onSubmit?: () => void;
  onEscape?: () => void;
  /** The field's accessible name. */
  label: string;
  /** What the field says while empty; the mode's own hint by default. */
  placeholder?: string;
  size: keyof typeof SIZES;
  /** The box around mode and field: shape, border, background. */
  className: string;
  inputRef?: Ref<HTMLInputElement>;
  /** Shown between the mode and the field, e.g. a search icon. */
  leading?: ReactNode;
  trailing?: ReactNode;
}) {
  const current = SEARCH_MODES.find((item) => item.id === mode) ?? SEARCH_MODES[0];
  const sizing = SIZES[size];
  return (
    <div className={`flex items-center ${className}`}>
      <ChoiceMenu
        dense
        triggerLabel={`检索方式：${current.label}`}
        triggerClassName={`flex shrink-0 items-center gap-1 ${sizing.trigger} text-xs font-mono font-bold text-on-surface-variant hover:text-on-surface transition-colors`}
        panelClassName="w-56"
        trigger={(open) => (
          <>
            {current.label}
            <ChevronDown
              className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`}
              aria-hidden="true"
            />
          </>
        )}
        sections={[
          {
            selected: mode,
            onSelect: (id) => onModeChange(id as SearchMode),
            items: SEARCH_MODES.map(({ id, label, description }) => ({ id, label, description })),
          },
        ]}
      />
      <span className="h-4 w-px shrink-0 bg-outline-variant/30" aria-hidden="true" />
      {leading}
      <input
        ref={inputRef}
        aria-label={label}
        name="query"
        // The browser's saved-entry fill paints the field blue; the history it offers is not ours.
        autoComplete="off"
        value={text}
        onChange={(event) => onTextChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && onEscape) onEscape();
          if (event.key !== "Enter" || !onSubmit) return;
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          event.preventDefault();
          onSubmit();
        }}
        placeholder={placeholder ?? PLACEHOLDERS[mode] ?? "标题、作者、关键词…"}
        className={`min-w-0 flex-1 bg-transparent ${sizing.input} text-on-surface outline-none placeholder:text-on-surface-variant/40`}
      />
      {trailing}
    </div>
  );
}
