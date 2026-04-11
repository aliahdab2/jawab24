import { useEffect, useRef, useCallback } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/router';
import { toast } from 'sonner';
import { useAuthStore, useUIStore } from '@/lib/store';
import { useTranslations } from 'next-intl';
import { isNativePlatform } from '@/lib/capacitor';
import type { SSEEvent, Page } from '@jawab24/shared';
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
        es.addEventListener('comment:received', (e) => {
            try {
                const event: SSEEvent<'comment:received'> = JSON.parse(e.data);
                queryClient.invalidateQueries({ queryKey: ['comments'] });
                queryClient.invalidateQueries({ queryKey: ['comments-stats'] });
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
                queryClient.invalidateQueries({ queryKey: ['comments'] });
                queryClient.invalidateQueries({ queryKey: ['comments-stats'] });
                if (!isOnPage('/comments') && event.data.replyMethod === 'ai') {
                    showToast(t('aiRepliedComment'));
                }
            } catch { /* malformed event — ignore */ }
        });

        es.addEventListener('comment:reply_failed', () => {
            queryClient.invalidateQueries({ queryKey: ['comments'] });
            queryClient.invalidateQueries({ queryKey: ['comments-stats'] });
        });

        // --- Message events ---
        es.addEventListener('message:received', (e) => {
            try {
                const event: SSEEvent<'message:received'> = JSON.parse(e.data);
                queryClient.invalidateQueries({ queryKey: ['messages'] });
                queryClient.invalidateQueries({ queryKey: ['messages-stats'] });
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
                queryClient.invalidateQueries({ queryKey: ['messages'] });
                queryClient.invalidateQueries({ queryKey: ['messages-stats'] });
                const replyMsg = event.data.message as Message | undefined;
                appendToConversationCache(queryClient, replyMsg, replyMsg?.senderId ?? '');
                if (!isOnPage('/messages') && event.data.replyMethod === 'ai') {
                    showToast(t('aiRepliedMessage'));
                }
            } catch { /* malformed event — ignore */ }
        });

        es.addEventListener('message:reply_failed', () => {
            queryClient.invalidateQueries({ queryKey: ['messages'] });
            queryClient.invalidateQueries({ queryKey: ['messages-stats'] });
            queryClient.invalidateQueries({ queryKey: ['conversation'] });
        });

        // --- Usage ---
        es.addEventListener('usage:updated', () => {
            queryClient.invalidateQueries({ queryKey: ['subscription-usage'] });
        });

        // --- Leads ---
        es.addEventListener('lead:captured', (e) => {
            try {
                const event: SSEEvent<'lead:captured'> = JSON.parse(e.data);
                queryClient.invalidateQueries({ queryKey: ['leads'] });
                queryClient.invalidateQueries({ queryKey: ['leads-count'] });
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
            setSSEStatus('disconnected');
        };
    }, [isAuthenticated, connectSSE, startPolling, setSSEStatus]);
}
