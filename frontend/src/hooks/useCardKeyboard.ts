import { useCallback } from 'react';

/**
 * Focus-ring classes for any div / span we mark as `role="button"`.
 * Pair with `useCardKeyboard` so keyboard users get the same affordance as mouse users.
 */
export const CLICKABLE_CARD_FOCUS =
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background';

/**
 * Returns a stable keyboard handler that triggers the passed callback when the
 * user presses Enter or Space. Use on any non-button element that acts as a
 * button (e.g. a clickable card div with `role="button"` and `tabIndex={0}`).
 */
export function useCardKeyboard(onActivate: () => void) {
  return useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onActivate();
      }
    },
    [onActivate],
  );
}
