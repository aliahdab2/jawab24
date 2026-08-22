import { useCallback, useEffect, useRef, type RefObject } from 'react';

/** Within this many px of the bottom, the reader counts as "at the bottom". */
const NEAR_BOTTOM_PX = 100;

/**
 * Chat-thread scrolling: keeps a scroll container pinned to its bottom for as
 * long as the reader is there, across container resizes.
 *
 * The resize re-pin is the part that matters. When the soft keyboard opens, a
 * modal's thread shrinks by the keyboard height over the eased
 * `--keyboard-height` transition. A bottom-anchored (`justify-end`) thread that
 * still fits rides the bottom edge up; the instant it overflows, the browser
 * leaves `scrollTop` at 0 and the content snaps to the TOP — so it reverses
 * direction mid-animation (reported as "the whole modal shakes" on the comments
 * modal, 2026-08-22) and settles with the newest bubble hidden under the
 * composer. Re-pinning on every resize keeps the bottom in view throughout.
 *
 * "At the bottom" is REMEMBERED from the last scroll event or `scrollToBottom`,
 * never measured after the resize: a container that just shrank by 300px is,
 * by measurement alone, 300px away from its bottom.
 *
 * Returns `isNearBottom` (a fresh measurement, for "new message" indicators)
 * and `scrollToBottom`.
 */
export function useStickToBottom<T extends HTMLElement>(ref: RefObject<T | null>) {
  // Fresh thread: content that still fits is at its bottom by definition.
  const stuck = useRef(true);

  const isNearBottom = useCallback(() => {
    const el = ref.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
  }, [ref]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'instant') => {
    const el = ref.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
    stuck.current = true;
  }, [ref]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const remember = () => {
      stuck.current = isNearBottom();
    };
    el.addEventListener('scroll', remember, { passive: true });
    const observer = new ResizeObserver(() => {
      if (stuck.current) scrollToBottom('instant');
    });
    observer.observe(el);
    return () => {
      el.removeEventListener('scroll', remember);
      observer.disconnect();
    };
  }, [ref, isNearBottom, scrollToBottom]);

  return { isNearBottom, scrollToBottom };
}
