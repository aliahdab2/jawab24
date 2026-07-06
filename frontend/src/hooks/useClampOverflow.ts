import { useEffect, useRef, useState, type RefObject } from 'react';

/**
 * Measures whether a line-clamped element is actually truncated, so a
 * "Show more / Show less" toggle can be rendered ONLY when the content
 * overflows its clamped height (never on short content that already fits).
 *
 * Re-measures on container resize (ResizeObserver — catches the modal/panel
 * rewrapping) and after async web-fonts load (`document.fonts.ready` — Cairo/
 * Tajawal shift the wrapped line count once they arrive), which pure CSS
 * `line-clamp` cannot report back to React.
 *
 * Attach the returned `ref` to the clamped element (the one carrying the
 * `line-clamp-*` class while collapsed). Pass the caller-owned `expanded`
 * flag: while expanded, measuring is skipped and the last collapsed reading is
 * kept, so the toggle stays visible to collapse again. Pass `content` so the
 * measurement re-runs whenever the text changes.
 *
 * @example
 * const [expanded, setExpanded] = useState(false);
 * const { ref, isOverflowing } = useClampOverflow<HTMLParagraphElement>(text, expanded);
 * <p ref={ref} className={clsx(!expanded && 'line-clamp-3')}>{text}</p>
 * {(isOverflowing || expanded) && (
 *   <button onClick={() => setExpanded(v => !v)}>{expanded ? 'Less' : 'More'}</button>
 * )}
 */
export function useClampOverflow<T extends HTMLElement = HTMLElement>(
  content: unknown,
  expanded: boolean,
): { ref: RefObject<T | null>; isOverflowing: boolean } {
  const ref = useRef<T>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || expanded) return;
    let cancelled = false;
    const measure = () => {
      if (!cancelled) setIsOverflowing(el.scrollHeight - el.clientHeight > 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    document.fonts?.ready.then(measure).catch(() => {
      /* font API unavailable — the initial measure stands */
    });
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [content, expanded]);

  return { ref, isOverflowing };
}
