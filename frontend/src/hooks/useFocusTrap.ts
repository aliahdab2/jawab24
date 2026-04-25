import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Trap keyboard focus inside a container while active. On activation, focus
 * moves to the first focusable element inside; Tab / Shift+Tab cycle within
 * the container. On deactivation, focus is restored to the element that was
 * focused when the trap was activated.
 *
 * @param enabled - Whether the trap is active (e.g. an open modal flag)
 * @returns ref to attach to the container element
 *
 * @example
 * const ref = useFocusTrap(isOpen);
 * return <div ref={ref}>...</div>;
 */
export function useFocusTrap<T extends HTMLElement = HTMLDivElement>(enabled: boolean) {
  const containerRef = useRef<T | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const container = containerRef.current;
    if (!container) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Move focus inside the container so screen readers + keyboard users start there.
    const focusables = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    (focusables[0] ?? container).focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const list = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (list.length === 0) {
        event.preventDefault();
        return;
      }
      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (event.shiftKey && (active === first || !container.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    container.addEventListener('keydown', handleKeyDown);
    return () => {
      container.removeEventListener('keydown', handleKeyDown);
      // Restore focus to whatever had it before the trap activated.
      previouslyFocused?.focus?.();
    };
  }, [enabled]);

  return containerRef;
}
