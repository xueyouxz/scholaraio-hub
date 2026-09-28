import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { libraryApi } from "../../../../core/library";
import { type MentionOption, type MentionToken, mentionTokenAt } from "../model/mentions";

/** How long typing pauses before papers are searched for. */
const SEARCH_DELAY_MS = 200;
const PAPER_LIMIT = 8;

/**
 * The `@` menu: for the mention at the caret, the literature collections whose
 * name matches, then the papers a keyword search finds. Collections are read
 * once and filtered here; papers are searched as the query settles.
 */
export function useMentionPicker(text: string, caret: number | null, enabled: boolean) {
  const [dismissed, setDismissed] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const position = Math.min(caret ?? text.length, text.length);
  const token: MentionToken | null = enabled ? mentionTokenAt(text, position) : null;
  const query = token?.query.trim() ?? "";
  const [searched, setSearched] = useState(query);
  useEffect(() => {
    const timer = setTimeout(() => setSearched(query), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query]);
  const collections = useQuery({
    queryKey: ["library", "collections"],
    queryFn: ({ signal }) => libraryApi.collections(signal),
    enabled: !!token,
    staleTime: 30_000,
  });
  const papers = useQuery({
    queryKey: ["library", "search", { query: searched, mode: "keyword", limit: PAPER_LIMIT }],
    queryFn: ({ signal }) =>
      libraryApi.search({ query: searched, mode: "keyword", limit: PAPER_LIMIT }, signal),
    enabled: !!token && searched.length > 0,
    staleTime: 30_000,
  });
  const options = useMemo<MentionOption[]>(() => {
    if (!token) return [];
    const needle = query.toLowerCase();
    const matching = (collections.data?.collections ?? [])
      .filter((collection) => collection.name.toLowerCase().includes(needle))
      .map((collection) => ({
        ref: { kind: "collection" as const, id: collection.id },
        label: collection.name,
        detail: `文献集合 · ${collection.paperCount} 篇`,
      }));
    const found =
      searched && searched === query
        ? (papers.data?.results ?? []).map(({ paper }) => ({
            ref: { kind: "paper" as const, id: paper.id },
            label: paper.title,
            detail: [paper.authors.split(/[,;]/)[0]?.trim(), paper.year]
              .filter(Boolean)
              .join(" · "),
          }))
        : [];
    return [...matching, ...found];
  }, [token, query, searched, collections.data, papers.data]);
  const signature = options.map((option) => `${option.ref.kind}:${option.ref.id}`).join("\n");
  useEffect(() => {
    if (!signature) return;
    setActiveIndex(0);
  }, [signature]);
  const loading = collections.isLoading || (searched.length > 0 && papers.isFetching);
  return {
    token,
    options,
    loading,
    /** The menu shows while a mention is typed, even before anything matches. */
    show: Boolean(token && !dismissed),
    activeIndex,
    setActiveIndex,
    dismiss: () => setDismissed(true),
    resume: () => setDismissed(false),
  };
}
