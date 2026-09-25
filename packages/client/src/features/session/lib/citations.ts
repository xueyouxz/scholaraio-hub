import type { LibraryCitation } from "@scholaraio-hub/shared";

export function citationUrl(citation: LibraryCitation): string {
  return `/library/${encodeURIComponent(citation.paperId)}?mode=markdown&line=${citation.startLine}`;
}

/** Turn `[ref-3]` markers into links to the cited passage; unknown ids stay as written. */
export function linkCitations(text: string, citations: readonly LibraryCitation[]): string {
  if (!citations.length) return text;
  return text.replace(/\[(ref-\d+)\]/g, (original, id: string) => {
    const citation = citations.find((item) => item.id === id);
    return citation ? `[${id.slice(4)}](${citationUrl(citation)})` : original;
  });
}
