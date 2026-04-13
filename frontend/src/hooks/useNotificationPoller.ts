import { useEffect } from 'react';
import { useAuthStore, useUIStore } from '@/lib/store';
import { getUnreadCount } from '@/lib/notifications';
import { captureError } from '@/lib/sentryHelpers';

/**
 * Singleton notification poller.
 *
 * Multiple components (mobile header bell, desktop sidebar bell) call this hook,
 * but only the first mounted instance starts the interval. Subsequent callers share
 * the same store value without issuing duplicate requests.
 *
 * Rate-limit backoff: when the backend returns HTTP 429, polling backs off for
 * the duration specified in retryAfter (defaulting to 60 s) before resuming.
 *
 * Circuit breaker: after 3 consecutive non-429 failures the poller stops and
 * fires a Sentry alert. This prevents silent hammering when the backend is down.
 */
let activePollers = 0;

const POLL_INTERVAL_MS = 60_000;
const CIRCUIT_BREAKER_THRESHOLD = 3;

export function useNotificationPoller() {
    const { isAuthenticated } = useAuthStore();
    const setNotificationUnreadCount = useUIStore((s) => s.setNotificationUnreadCount);

    useEffect(() => {
        if (!isAuthenticated) return;

        activePollers++;
        const isFirst = activePollers === 1;

        if (!isFirst) {
            return () => { activePollers--; };
        }

        let timerId: ReturnType<typeof setTimeout> | null = null;
        let cancelled = false;
        let consecutiveErrors = 0;

        const scheduleNext = (delayMs: number) => {
            timerId = setTimeout(async () => {
                if (cancelled) return;
                try {
                    const result = await getUnreadCount();
                    consecutiveErrors = 0; // reset on any success
                    setNotificationUnreadCount(result.count);
                    scheduleNext(result.retryAfter ? result.retryAfter * 1000 : POLL_INTERVAL_MS);
                } catch (err) {
                    consecutiveErrors++;
                    if (consecutiveErrors >= CIRCUIT_BREAKER_THRESHOLD) {
                        // Backend is unreachable — stop polling and alert Sentry.
                        // The user will get fresh data when they reload or re-authenticate.
                        captureError(err, 'Notification poller circuit breaker tripped', {
                            level: 'error',
                            tags: { area: 'notifications' },
                            extra: { consecutiveErrors },
                        });
                        return; // do NOT reschedule
                    }
                    scheduleNext(POLL_INTERVAL_MS);
                }
            }, delayMs);
        };

        // Fire immediately, then schedule
        (async () => {
            try {
                const result = await getUnreadCount();
                if (cancelled) return;
                consecutiveErrors = 0;
                setNotificationUnreadCount(result.count);
                scheduleNext(result.retryAfter ? result.retryAfter * 1000 : POLL_INTERVAL_MS);
            } catch {
                if (cancelled) return;
                consecutiveErrors++;
                scheduleNext(POLL_INTERVAL_MS);
            }
        })();

        return () => {
            cancelled = true;
            if (timerId) clearTimeout(timerId);
            activePollers--;
        };
    }, [isAuthenticated, setNotificationUnreadCount]);
}
