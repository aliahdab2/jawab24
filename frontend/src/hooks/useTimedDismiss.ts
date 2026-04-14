import { useState, useCallback } from 'react';

interface DismissState {
  dismissedAt: number;
  count: number;
}

interface UseTimedDismissOptions {
  /** localStorage key for this dismiss state */
  key: string;
  /** How long the dismiss lasts in milliseconds */
  durationMs: number;
  /**
   * Current item count. If the count increases after dismiss, the dismiss
   * is invalidated and the element re-appears. Pass 0 to skip count tracking.
   */
  count?: number;
}

interface UseTimedDismissReturn {
  /** Whether the element should be hidden */
  dismissed: boolean;
  /** Call to dismiss the element (saves to localStorage) */
  dismiss: () => void;
}

/**
 * Hook for time-based dismissals persisted in localStorage.
 *
 * Reads localStorage synchronously during render to avoid layout flash.
 * Supports optional count-based re-trigger: if the count increases
 * since dismissal, the element re-appears automatically.
 */
export function useTimedDismiss({
  key,
  durationMs,
  count = 0,
}: UseTimedDismissOptions): UseTimedDismissReturn {
  const [dismissedNow, setDismissedNow] = useState(false);

  // Synchronous localStorage check during render — no useEffect, no flash
  let dismissedFromStorage = false;
  if (typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const state: DismissState = JSON.parse(raw);
        const expired = Date.now() - state.dismissedAt > durationMs;
        if (!expired) {
          // If count tracking is active, re-show when count increases
          dismissedFromStorage = count <= state.count;
        }
      }
    } catch {
      // Corrupted localStorage — treat as not dismissed
    }
  }

  const dismiss = useCallback(() => {
    const state: DismissState = { dismissedAt: Date.now(), count };
    localStorage.setItem(key, JSON.stringify(state));
    setDismissedNow(true);
  }, [key, count]);

  return {
    dismissed: dismissedNow || dismissedFromStorage,
    dismiss,
  };
}
