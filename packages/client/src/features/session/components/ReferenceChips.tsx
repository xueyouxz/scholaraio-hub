import type { LiteratureRef } from "@scholaraio-hub/shared";
import { useQuery } from "@tanstack/react-query";
import { FileText, Library, X } from "lucide-react";
import { libraryApi } from "../../../core/library";

/**
 * The literature a session refers to, as removable chips above the composer.
 * Each turn is answered from all of them until one is removed.
 */
export function ReferenceChips({
  references,
  disabled,
  onRemove,
}: {
  references: LiteratureRef[];
  disabled?: boolean;
  onRemove: (reference: LiteratureRef) => void;
}) {
  const papers = useQuery({
    queryKey: ["library", "papers"],
    queryFn: ({ signal }) => libraryApi.papers(signal),
    enabled: references.some((ref) => ref.kind === "paper"),
  });
  const collections = useQuery({
    queryKey: ["library", "collections"],
    queryFn: ({ signal }) => libraryApi.collections(signal),
    enabled: references.some((ref) => ref.kind === "collection"),
  });
  if (references.length === 0) return null;
  const name = (ref: LiteratureRef) =>
    ref.kind === "paper"
      ? (papers.data?.papers.find((paper) => paper.id === ref.id)?.title ?? ref.id)
      : (collections.data?.collections.find((item) => item.id === ref.id)?.name ?? ref.id);
  return (
    <ul aria-label="引用的文献" className="flex flex-wrap items-center gap-1.5">
      {references.map((ref) => {
        const label = name(ref);
        const Icon = ref.kind === "paper" ? FileText : Library;
        return (
          <li
            key={`${ref.kind}:${ref.id}`}
            className="inline-flex items-center gap-1.5 max-w-[260px] px-2.5 py-1 rounded-full text-xs bg-surface-container border border-outline-variant/20 text-on-surface-variant"
          >
            <Icon size={11} className="shrink-0" aria-hidden="true" />
            <span className="truncate" title={label}>
              {label}
            </span>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onRemove(ref)}
              aria-label={`不再引用 ${label}`}
              className="text-on-surface-variant hover:text-error transition-colors shrink-0"
            >
              <X size={11} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
