import { useCallback, useEffect, useRef, useState } from "react";

/** Within this many pixels of the end the transcript counts as at the bottom. */
const AT_BOTTOM = 120;
/** Scrolling back this close to the end re-pins the transcript. */
const REPIN = 24;
/** How long after a scroll gesture a scroll event is taken as the reader's. */
const INTENT_MS = 300;
const NAVIGATION_KEYS = new Set(["ArrowUp", "PageUp", "Home", " "]);

/**
 * Keep a scroll container pinned to its end while its content grows, until the
 * reader scrolls away; scrolling back to the end re-pins it.
 *
 * Growth is observed on the content element, not inferred from new messages,
 * so late layout changes follow too: syntax highlighting, math, a lazily
 * loaded diff, an expanded row. Only the reader's own gestures (wheel, touch,
 * keys, the scrollbar) unpin: the browser also moves `scrollTop` by itself,
 * e.g. when scroll anchoring compensates for a block above that shrank, and
 * that must not count as scrolling away.
 *
 * Growth only pins while `live` (a turn is running): once the transcript is
 * settled, opening a row above the end must not yank the reader away from it.
 *
 * Pass the returned refs as callback refs; either element may unmount and
 * remount (the transcript is swapped out while a paper is open).
 */
export function useStickToBottom(live: boolean) {
  const [viewport, setViewport] = useState<HTMLElement | null>(null);
  const [content, setContent] = useState<HTMLElement | null>(null);
  const following = useRef(true);
  const liveRef = useRef(live);
  liveRef.current = live;
  const [atBottom, setAtBottom] = useState(true);

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = "auto") => {
      following.current = true;
      setAtBottom(true);
      viewport?.scrollTo({ top: viewport.scrollHeight, behavior });
    },
    [viewport],
  );

  useEffect(() => {
    if (!viewport) return;
    let intentUntil = 0;
    let dragging = false;
    const intent = () => {
      intentUntil = performance.now() + INTENT_MS;
    };
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) intent();
    };
    // Page keys scroll the transcript when focus is in it or nowhere in particular.
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as Node | null;
      const inTranscript = target === document.body || (!!target && viewport.contains(target));
      if (inTranscript && NAVIGATION_KEYS.has(event.key)) intent();
    };
    // A press on the container itself (not on its content) is on the scrollbar.
    const onPointerDown = (event: PointerEvent) => {
      if (event.target === viewport) dragging = true;
    };
    const onPointerUp = () => {
      dragging = false;
    };
    const onScroll = () => {
      const distance = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      if (distance < REPIN) following.current = true;
      else if (dragging || performance.now() < intentUntil) following.current = false;
      setAtBottom(following.current || distance < AT_BOTTOM);
    };
    viewport.addEventListener("wheel", onWheel, { passive: true });
    viewport.addEventListener("touchmove", intent, { passive: true });
    window.addEventListener("keydown", onKey);
    viewport.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointerup", onPointerUp);
    viewport.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      viewport.removeEventListener("wheel", onWheel);
      viewport.removeEventListener("touchmove", intent);
      window.removeEventListener("keydown", onKey);
      viewport.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      viewport.removeEventListener("scroll", onScroll);
    };
  }, [viewport]);

  useEffect(() => {
    if (!viewport || !content) return;
    // A remounted transcript starts at the end, as a freshly opened one does.
    following.current = true;
    setAtBottom(true);
    viewport.scrollTo({ top: viewport.scrollHeight });
    const observer = new ResizeObserver(() => {
      if (following.current && liveRef.current) viewport.scrollTo({ top: viewport.scrollHeight });
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [viewport, content]);

  // The commit that ends a turn (its footer, the settled messages) lands with
  // `live` already false; follow that last change too.
  useEffect(() => {
    if (!live && following.current) viewport?.scrollTo({ top: viewport.scrollHeight });
  }, [live, viewport]);

  return { viewportRef: setViewport, contentRef: setContent, atBottom, scrollToBottom };
}
