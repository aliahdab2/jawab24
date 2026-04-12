import { useRef, useCallback } from 'react';

/**
 * Auto-resizes a textarea to fit its content.
 * Preserves the nearest scrollable ancestor's scroll position to prevent jumps.
 * Shared by SectionEditor and GapCard.
 *
 * @param minHeight - minimum height in px (default 80)
 * @param maxHeight - optional cap in px
 */
export function useTextareaAutoResize(minHeight = 80, maxHeight?: number) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const autoResize = useCallback(() => {
    const el = ref.current;
    if (!el) return;

    // Find the nearest scrollable ancestor and save its scroll position.
    // Setting height='auto' momentarily collapses the textarea, which can
    // cause the scroll container to jump — restoring scrollTop prevents that.
    let scrollEl: HTMLElement | null = el.parentElement;
    while (scrollEl && !['auto', 'scroll'].includes(getComputedStyle(scrollEl).overflowY)) {
      scrollEl = scrollEl.parentElement as HTMLElement | null;
    }
    const savedTop = scrollEl?.scrollTop ?? 0;

    el.style.height = 'auto';
    const desired = Math.max(minHeight, el.scrollHeight);
    el.style.height = `${maxHeight ? Math.min(maxHeight, desired) : desired}px`;

    if (scrollEl) scrollEl.scrollTop = savedTop;
  }, [minHeight, maxHeight]);

  return { ref, autoResize };
}
