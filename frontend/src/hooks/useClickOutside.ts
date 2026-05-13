import { useEffect, type RefObject } from 'react';

/**
 * Calls `onOutside` when a pointer event lands outside the referenced element.
 * Skips listening when `enabled` is false so callers can pause without unmounting.
 *
 * Uses `pointerdown` so touch and mouse share one path and the handler fires
 * before click — preventing the same gesture from re-toggling an open popover.
 *
 * @example
 * useClickOutside(ref, () => setOpen(false), open);
 */
export function useClickOutside<T extends HTMLElement>(
  ref: RefObject<T | null>,
  onOutside: () => void,
  enabled: boolean = true,
): void {
  useEffect(() => {
    if (!enabled) return;

    const handler = (event: PointerEvent) => {
      const node = ref.current;
      if (node && !node.contains(event.target as Node)) {
        onOutside();
      }
    };

    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [ref, onOutside, enabled]);
}
