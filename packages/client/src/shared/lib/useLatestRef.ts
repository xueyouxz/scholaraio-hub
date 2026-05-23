import { useLayoutEffect, useRef } from "react";

/**
 * Returns a ref that always reflects the latest committed value of `value`.
 *
 * Use this when an event handler or async callback needs to read the most
 * recent prop/state without re-creating the handler on every change — instead
 * of writing `ref.current = value` during render (which mutates during render
 * and can disagree with concurrent rendering), keep the mirror in sync inside
 * a layout effect.
 */
export function useLatestRef<T>(value: T) {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}
