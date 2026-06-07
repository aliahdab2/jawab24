import { useEffect } from 'react';

interface UseArrowKeyNavigationOptions {
  /** When false, the listener is not attached (e.g. modal closed, nav disabled). */
  enabled?: boolean;
  onPrev: () => void;
  onNext: () => void;
  /** RTL: ArrowLeft → next, ArrowRight → prev (mirrors the visual arrows). */
  rtl?: boolean;
}

/**
 * Step through a list with the ← / → arrow keys, RTL-aware.
 *
 * Ignores key presses while the user is typing in an input/textarea/
 * contenteditable so it never hijacks text-cursor movement. Pair the bounds
 * (e.g. hasPrev/hasNext) into the onPrev/onNext callbacks at the call site.
 */
export function useArrowKeyNavigation({
  enabled = true,
  onPrev,
  onNext,
  rtl = false,
}: UseArrowKeyNavigationOptions) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      const nextKey = rtl ? 'ArrowLeft' : 'ArrowRight';
      e.preventDefault();
      if (e.key === nextKey) onNext();
      else onPrev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, rtl, onNext, onPrev]);
}
