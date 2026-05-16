import { useEffect, useRef, useCallback } from 'react';
import { useQueryClient, type QueryClient, type InfiniteData } from '@tanstack/react-query';
import { useRouter } from 'next/router';
import { toast } from 'sonner';
import { useAuthStore, useUIStore } from '@/lib/store';
import { useTranslations } from 'next-intl';
import { isNativePlatform } from '@/lib/capacitor';
import { trimInfinitePagesToFirst } from '@/lib/queryInvalidation';
import type { SSEEvent, Page, Comment } from '@jawab24/shared';
import type { Message } from '@/lib/api';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://jawab24.com/api';

/**
 * Returns true if the given pageId belongs to a page with auto-reply active.
 * Falls back to true when pages haven't loaded yet (avoids false-negatives on
 * first render) and false when the page is known but toggled off.
 */
function isActivePageId(pages: Page[] | undefined, pageId: string): boolean {
    if (!pages) return true;
    return pages.some(
        p => p.id === pageId && p.isConnected !== false && (p.autoReplyEnabled || p.instagramAutoReplyEnabled),
    );
}

/**
 * Optimistically append a message to the conversation cache.
 * Falls back to invalidation when the SSE event doesn't carry the full message
 * (backward compat with older backend versions).
 */
function appendToConversationCache(
    qc: QueryClient,
    msg: Message | undefined,
    senderId: string,
): void {
    if (msg) {
        qc.setQueriesData<Message[]>(
            { queryKey: ['conversation', senderId] },
            (old) => {
                if (!old) return [msg];
                if (old.some(m => m.id === msg.id)) return old;
                return [...old, msg];
            },
        );
    } else {
        qc.invalidateQueries({ queryKey: ['conversation'] });
    }
}

/** Max reconnect delay in ms */
const MAX_BACKOFF = 30_000;
/** Toast rate-limit interval (ms) */
const TOAST_THROTTLE = 5_000;

/**
 * Native mobile polling interval (ms).
 * Mobile apps rely on push notifications for instant alerts.
 * Polling is a lightweight fallback to keep dashboard stats fresh.
 */
const NATIVE_POLL_INTERVAL = 60_000;

/**
 * Trailing-edge debounce window for list/stats query invalidations triggered
 * by SSE events. A burst of N events within this window coalesces into a
 * single refetch per queryKey. Short enough to feel real-time, long enough
 * to absorb natural bursts (AI worker flush, webhook waves) that previously
 * self-induced 429s against the nginx api_limit.
 */
const SSE_INVALIDATE_DEBOUNCE_MS = 400;
/**
 * Hard cap on how long a queued invalidation can be delayed by repeated
 * resets. Prevents a sustained event stream from starving the UI of updates
 * indefinitely — after MAX_WAIT, the pending refetch fires even if more
 * events keep arriving.
 */
const SSE_INVALIDATE_MAX_WAIT_MS = 2_000;

/**
 * Create a per-queryKey debounced invalidator with a max-wait cap. Returns
 * the invalidate function plus flush() to clear pending timers on unmount.
 *
 * Behavior: each invalidate() resets the trailing-edge timer (debounceMs),
 * but the refetch is forced after maxWaitMs from the first queued call so
 * a sustained event stream cannot starve the UI indefinitely.
 *
 * `trimInfinite: true` resets matching infinite queries to their first page
 * before invalidating — use for `['messages']` / `['comments']` list keys.
 */
function createDebouncedInvalidator(qc: QueryClient, debounceMs: number, maxWaitMs: number) {
    interface Pending {
        trailing: ReturnType<typeof setTimeout>;
        maxWait: ReturnType<typeof setTimeout>;
        trimInfinite: boolean;
    }
    const pending = new Map<string, Pending>();

    const fire = (key: string, queryKey: readonly unknown[], trimInfinite: boolean) => {
        const entry = pending.get(key);
        if (!entry) return;
        clearTimeout(entry.trailing);
        clearTimeout(entry.maxWait);
        pending.delete(key);
        if (trimInfinite) trimInfinitePagesToFirst(qc, queryKey);
        qc.invalidateQueries({ queryKey });
    };

    const invalidate = (queryKey: readonly unknown[], opts?: { trimInfinite?: boolean }) => {
        const key = JSON.stringify(queryKey);
        const trimInfinite = opts?.trimInfinite ?? false;
        const existing = pending.get(key);
        if (existing) {
            clearTimeout(existing.trailing);
            existing.trailing = setTimeout(() => fire(key, queryKey, existing.trimInfinite), debounceMs);
            // Preserve trimInfinite if any caller in the burst requested it.
            existing.trimInfinite = existing.trimInfinite || trimInfinite;
            return;
        }
        const trailing = setTimeout(() => fire(key, queryKey, trimInfinite), debounceMs);
        const maxWait = setTimeout(() => fire(key, queryKey, pending.get(key)?.trimInfinite ?? trimInfinite), maxWaitMs);
        pending.set(key, { trailing, maxWait, trimInfinite });
    };

    const flush = () => {
        for (const entry of pending.values()) {
            clearTimeout(entry.trailing);
            clearTimeout(entry.maxWait);
        }
        pending.clear();
    };

    return { invalidate, flush };
}

/**
 * Real-time updates hook.
 *
 * - **Web**: SSE (EventSource) for instant updates.
 * - **Native mobile**: Lightweight polling. Android WebView's EventSource is
 *   unreliable (connections drop silently, causing perpetual "reconnecting"
 *   state and battery drain). Push notifications handle instant alerts;
 *   polling keeps dashboard stats fresh.
 *
 * Mount once in _app.tsx after hydration + auth.
 */
export function useSSE(): void {
    const queryClient = useQueryClient();
    const router = useRouter();
    const t = useTranslations('sse');

    const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

    const setSSEStatus = useUIStore((s) => s.setSSEStatus);
    const incrementUnreadComments = useUIStore((s) => s.incrementUnreadComments);
    const incrementUnreadMessages = useUIStore((s) => s.incrementUnreadMessages);
    const incrementNewLeads = useUIStore((s) => s.incrementNewLeads);

    const esRef = useRef<EventSource | null>(null);
    const retryCountRef = useRef(0);
    const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const lastToastRef = useRef(0);
    // Debounced list/stats invalidator: coalesces SSE-event-driven invalidations
    // so a burst of events causes one refetch per queryKey instead of N. Without
    // this, busy pages on /messages or /comments self-induce nginx 429s.
    const debouncedRef = useRef<ReturnType<typeof createDebouncedInvalidator> | null>(null);
    if (debouncedRef.current === null) {
        debouncedRef.current = createDebouncedInvalidator(queryClient, SSE_INVALIDATE_DEBOUNCE_MS, SSE_INVALIDATE_MAX_WAIT_MS);
    }
    const debouncedInvalidate = debouncedRef.current.invalidate;
    // Keep a ref to router so event handlers always see the current value
    // without making connectSSE depend on router (which changes on every navigation).
    const routerRef = useRef(router);
    useEffect(() => { routerRef.current = router; });

    /** Rate-limited toast — max 1 per TOAST_THROTTLE ms */
    const showToast = useCallback(
        (message: string, action?: { label: string; onClick: () => void }) => {
            const now = Date.now();
            if (now - lastToastRef.current < TOAST_THROTTLE) return;
            lastToastRef.current = now;
            toast(message, action ? { action } : undefined);
        },
        [],
    );

    /** Whether the user is currently on a given page path */
    const isOnPage = useCallback(
        (page: string) => routerRef.current.pathname.includes(page),
        [],
    );

    /**
     * Stats badge invalidates from anywhere (visible in sidebar/nav). The
     * paginated list only needs to refresh when the user is actually on that
     * page — otherwise the next navigation triggers a fresh fetch anyway.
     * Wraps the repeated debounced-invalidate pattern used by every list-style
     * SSE handler (comments, messages, leads).
     */
    const invalidateListAndStats = useCallback(
        (opts: { listKey: readonly unknown[]; statsKey: readonly unknown[]; pageRoute: string }) => {
            debouncedInvalidate(opts.statsKey);
            if (isOnPage(opts.pageRoute)) {
                debouncedInvalidate(opts.listKey, { trimInfinite: true });
            }
        },
        [debouncedInvalidate, isOnPage],
    );

    // ── Web: SSE via EventSource ──────────────────────────────────────

    const connectSSE = useCallback(() => {
        if (typeof window === 'undefined') return;
        if (!isAuthenticated) return;

        const url = `${API_URL}/sse/events`;
        const es = new EventSource(url, { withCredentials: true });
        esRef.current = es;

        es.addEventListener('connected', () => {
            retryCountRef.current = 0;
            setSSEStatus('connected');
        });

        // --- Comment events ---
        // Invalidations are debounced (see SSE_INVALIDATE_DEBOUNCE_MS) so a burst
        // of events coalesces into a single refetch per queryKey. List/stats
        // queries are filtered server aggregates — reconstructing them from
        // individual event payloads is fragile, so debounce + refetch is the
        // correct pattern instead of optimistic patching here.
        es.addEventListener('comment:received', (e) => {
            try {
                const event: SSEEvent<'comment:received'> = JSON.parse(e.data);
                invalidateListAndStats({ listKey: ['comments'], statsKey: ['comments-stats'], pageRoute: '/comments' });
                if (!isOnPage('/comments') && isActivePageId(queryClient.getQueryData<Page[]>(['pages']), event.data.pageId)) {
                    incrementUnreadComments();
                    showToast(
                        t('newComment', { name: event.data.fromName || '' }),
                        { label: t('view'), onClick: () => routerRef.current.push('/comments') },
                    );
                }
            } catch { /* malformed event — ignore */ }
        });

        es.addEventListener('comment:reply_sent', (e) => {
            try {
                const event: SSEEvent<'comment:reply_sent'> = JSON.parse(e.data);
                const { replyMethod } = event.data;
                invalidateListAndStats({ listKey: ['comments'], statsKey: ['comments-stats'], pageRoute: '/comments' });
                if (!isOnPage('/comments') && replyMethod === 'ai') {
                    const name = event.data.senderName?.trim();
                    showToast(name ? t('aiRepliedCommentNamed', { name }) : t('aiRepliedComment'));
                }
            } catch { /* malformed event — ignore */ }
        });

        es.addEventListener('comment:reply_failed', () => {
            invalidateListAndStats({ listKey: ['comments'], statsKey: ['comments-stats'], pageRoute: '/comments' });
        });

        // Comment intentionally not replied to (friend-tag, spam, offensive).
        // Backend has already resolved the comment; we patch the cache so the
        // card flips from "Pending" → "Resolved" without a round-trip, and
        // refresh stats so the "Needs Action" count decrements.
        es.addEventListener('comment:skipped', (e) => {
            try {
                const event: SSEEvent<'comment:skipped'> = JSON.parse(e.data);
                const { commentId } = event.data;
                debouncedInvalidate(['comments-stats']);
                queryClient.setQueriesData<InfiniteData<{ data: Comment[]; pagination: { nextCursor?: string | null } }>>(
                    { queryKey: ['comments'] },
                    (old) => {
                        if (!old) return old;
                        return {
                            ...old,
                            pages: old.pages.map(page => ({
                                ...page,
                                data: page.data.map(c =>
                                    c.id === commentId ? { ...c, resolved: true } : c
                                ),
                            })),
                        };
                    },
                );
            } catch { /* malformed event — ignore */ }
        });

        // --- Message events ---
        // Same rationale as comment events: debounce list/stats invalidations so
        // bursts (AI worker flushing replies, webhook waves) collapse into one
        // refetch per queryKey. Conversation-detail patches stay direct
        // (setQueriesData) since they're surgical, not refetches.
        es.addEventListener('message:received', (e) => {
            try {
                const event: SSEEvent<'message:received'> = JSON.parse(e.data);
                invalidateListAndStats({ listKey: ['messages'], statsKey: ['messages-stats'], pageRoute: '/messages' });
                appendToConversationCache(queryClient, event.data.message as Message | undefined, event.data.senderId);
                if (!isOnPage('/messages') && isActivePageId(queryClient.getQueryData<Page[]>(['pages']), event.data.pageId)) {
                    incrementUnreadMessages();
                    showToast(
                        t('newMessage', { name: event.data.senderName || '' }),
                        { label: t('view'), onClick: () => routerRef.current.push('/messages') },
                    );
                }
            } catch { /* malformed event — ignore */ }
        });

        es.addEventListener('message:reply_sent', (e) => {
            try {
                const event: SSEEvent<'message:reply_sent'> = JSON.parse(e.data);
                invalidateListAndStats({ listKey: ['messages'], statsKey: ['messages-stats'], pageRoute: '/messages' });
                const replyMsg = event.data.message as Message | undefined;
                appendToConversationCache(queryClient, replyMsg, replyMsg?.senderId ?? '');
                if (!isOnPage('/messages') && event.data.replyMethod === 'ai') {
                    const name = event.data.senderName?.trim();
                    showToast(name ? t('aiRepliedMessageNamed', { name }) : t('aiRepliedMessage'));
                }
            } catch { /* malformed event — ignore */ }
        });

        es.addEventListener('message:reply_failed', () => {
            invalidateListAndStats({ listKey: ['messages'], statsKey: ['messages-stats'], pageRoute: '/messages' });
            if (isOnPage('/messages')) {
                debouncedInvalidate(['conversation']);
            }
        });

        // --- Usage ---
        es.addEventListener('usage:updated', () => {
            debouncedInvalidate(['subscription-usage']);
        });

        // --- Leads ---
        es.addEventListener('lead:captured', (e) => {
            try {
                const event: SSEEvent<'lead:captured'> = JSON.parse(e.data);
                invalidateListAndStats({ listKey: ['leads'], statsKey: ['leads-count'], pageRoute: '/leads' });
                if (!isOnPage('/leads')) {
                    incrementNewLeads();
                    showToast(
                        t('newLead', { name: event.data.senderName || event.data.phone }),
                        { label: t('view'), onClick: () => routerRef.current.push('/leads') },
                    );
                }
            } catch { /* malformed event — ignore */ }
        });

        // --- Heartbeat (no action needed — keeps connection alive) ---
        es.addEventListener('heartbeat', () => {
            // no-op
        });

        // --- Error / reconnect ---
        es.onerror = () => {
            es.close();
            esRef.current = null;
            setSSEStatus('reconnecting');

            const delay = Math.min(
                1000 * Math.pow(2, retryCountRef.current),
                MAX_BACKOFF,
            );
            retryCountRef.current++;

            retryTimerRef.current = setTimeout(connectSSE, delay);
        };
    }, [
        isAuthenticated,
        queryClient,
        setSSEStatus,
        incrementUnreadComments,
        incrementUnreadMessages,
        incrementNewLeads,
        isOnPage,
        showToast,
        t,
        debouncedInvalidate,
        invalidateListAndStats,
    ]);

    // ── Native mobile: lightweight polling ─────────────────────────────

    const startPolling = useCallback(() => {
        if (pollTimerRef.current) return; // already polling

        // Mark as connected immediately — no "reconnecting" indicator on native
        setSSEStatus('connected');

        pollTimerRef.current = setInterval(() => {
            queryClient.invalidateQueries({ queryKey: ['comments'] });
            queryClient.invalidateQueries({ queryKey: ['comments-stats'] });
            queryClient.invalidateQueries({ queryKey: ['messages'] });
            queryClient.invalidateQueries({ queryKey: ['messages-stats'] });
            queryClient.invalidateQueries({ queryKey: ['conversation'] });
            queryClient.invalidateQueries({ queryKey: ['subscription-usage'] });
        }, NATIVE_POLL_INTERVAL);
    }, [queryClient, setSSEStatus]);

    // ── Lifecycle ──────────────────────────────────────────────────────

    useEffect(() => {
        if (!isAuthenticated) {
            // Not authenticated — tear down
            if (esRef.current) {
                esRef.current.close();
                esRef.current = null;
            }
            if (retryTimerRef.current) {
                clearTimeout(retryTimerRef.current);
                retryTimerRef.current = null;
            }
            if (pollTimerRef.current) {
                clearInterval(pollTimerRef.current);
                pollTimerRef.current = null;
            }
            setSSEStatus('disconnected');
            return;
        }

        if (isNativePlatform()) {
            startPolling();
        } else {
            connectSSE();
        }

        return () => {
            if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
            if (esRef.current) {
                esRef.current.close();
                esRef.current = null;
            }
            if (pollTimerRef.current) {
                clearInterval(pollTimerRef.current);
                pollTimerRef.current = null;
            }
            debouncedRef.current?.flush();
            setSSEStatus('disconnected');
        };
    }, [isAuthenticated, connectSSE, startPolling, setSSEStatus]);
}
