import { useEffect } from 'react';
import { useAuthStore, useUIStore } from '@/lib/store';
import { getUnreadCount } from '@/lib/notifications';

/**
 * Singleton notification poller.
 *
 * Multiple components (mobile header bell, desktop sidebar bell) call this hook,
 * but only the first mounted instance starts the interval. Subsequent callers share
 * the same store value without issuing duplicate requests.
 *
 * When the backend returns HTTP 429, polling backs off for the duration specified
 * in retryAfter (defaulting to 60 s) before resuming the normal schedule.
 */
let activePollers = 0;

const POLL_INTERVAL_MS = 60_000;

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

        const scheduleNext = (delayMs: number) => {
            timerId = setTimeout(async () => {
                if (cancelled) return;
                const result = await getUnreadCount();
                setNotificationUnreadCount(result.count);
                scheduleNext(result.retryAfter ? result.retryAfter * 1000 : POLL_INTERVAL_MS);
            }, delayMs);
        };

        // Fire immediately, then schedule
        (async () => {
            const result = await getUnreadCount();
            if (cancelled) return;
            setNotificationUnreadCount(result.count);
            scheduleNext(result.retryAfter ? result.retryAfter * 1000 : POLL_INTERVAL_MS);
        })();

        return () => {
            cancelled = true;
            if (timerId) clearTimeout(timerId);
            activePollers--;
        };
    }, [isAuthenticated, setNotificationUnreadCount]);
}
