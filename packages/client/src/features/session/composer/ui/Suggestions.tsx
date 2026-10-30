import type { SlashCommand } from "@scholaraio-hub/shared";
import { FileText, Library, Loader2 } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import type { MentionOption } from "../model/mentions";
import type { Typeahead } from "../model/typeahead";

/**
 * The menu a typeahead opens above the composer. The active item follows the
 * keys (see `typeaheadKey`) and the pointer, and stays scrolled into view.
 */
function SuggestionList<T>({
  menu,
  onSelect,
  itemKey,
  renderItem,
  itemTitle,
  className,
  itemClassName,
  empty,
}: {
  menu: Typeahead<T>;
  onSelect: (item: T) => void;
  itemKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  itemTitle?: (item: T) => string | undefined;
  /** The menu's size. */
  className: string;
  /** How an item lays out its content. */
  itemClassName: string;
  /** Shown while there are no items. */
  empty?: ReactNode;
}) {
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const { items, activeIndex, setActiveIndex } = menu;
  useEffect(() => {
    optionRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);
  return (
    <div
      className={`absolute bottom-full left-0 z-30 mb-2 overflow-y-auto border border-outline-variant/20 rounded-xl bg-surface-container-lowest shadow-lg p-1 ${className}`}
    >
      {items.map((item, index) => (
        <button
          key={itemKey(item)}
          type="button"
          ref={(element) => {
            optionRefs.current[index] = element;
          }}
          onMouseEnter={() => setActiveIndex(index)}
          onClick={() => onSelect(item)}
          title={itemTitle?.(item)}
          aria-selected={index === activeIndex}
          className={`w-full text-left flex px-3 py-2 rounded-lg transition-colors ${itemClassName} ${
            index === activeIndex ? "bg-surface-container" : "bg-transparent"
          }`}
        >
          {renderItem(item)}
        </button>
      ))}
      {items.length === 0 ? empty : null}
    </div>
  );
}

/** The `/` menu: commands for the token at the caret. */
export function SlashCommandSuggestions({
  menu,
  onSelect,
}: {
  menu: Typeahead<SlashCommand>;
  onSelect: (command: SlashCommand) => void;
}) {
  return (
    <SuggestionList
      menu={menu}
      onSelect={onSelect}
      itemKey={(command) => command.name}
      itemTitle={(command) => command.description || undefined}
      className="w-fit max-w-full max-h-64"
      itemClassName="min-w-max items-center"
      renderItem={(command) => (
        <span className="font-mono text-[11px] text-primary font-bold whitespace-nowrap">
          {command.trigger ?? "/"}
          {command.name}
          {command.argumentHint ? ` ${command.argumentHint}` : ""}
        </span>
      )}
    />
  );
}

/** The `@` menu: literature collections, then papers, each with what it is. */
export function MentionSuggestions({
  menu,
  loading,
  onSelect,
}: {
  menu: Typeahead<MentionOption>;
  loading: boolean;
  onSelect: (option: MentionOption) => void;
}) {
  return (
    <SuggestionList
      menu={menu}
      onSelect={onSelect}
      itemKey={(option) => `${option.ref.kind}:${option.ref.id}`}
      className="w-[min(28rem,100%)] max-h-72"
      itemClassName="items-start gap-2"
      renderItem={(option) => {
        const Icon = option.ref.kind === "collection" ? Library : FileText;
        return (
          <>
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
          </>
        );
      }}
      empty={
        <p className="flex items-center gap-2 px-3 py-2 text-xs text-on-surface-variant">
          {loading ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : null}
          {loading ? "查找中…" : "输入文献集合名称或论文关键词"}
        </p>
      }
    />
  );
}
