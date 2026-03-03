import { useEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/router';
import { toast } from 'sonner';
import { useAuthStore, useUIStore } from '@/lib/store';
import { useTranslation } from '@/i18n';
import { isNativePlatform } from '@/lib/capacitor';
import type { SSEEvent } from '@jawab24/shared';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://jawab24.com/api';

/** Max reconnect delay in ms */
const MAX_BACKOFF = 30_000;
/** Toast rate-limit interval (ms) */
const TOAST_THROTTLE = 5_000;

/**
 * Real-time SSE hook — connects to the backend EventSource stream,
 * invalidates React Query caches, updates unread badges, and shows toasts.
 *
 * Mount once in _app.tsx after hydration + auth.
 */
export function useSSE(): void {
    const queryClient = useQueryClient();
    const router = useRouter();
    const { t } = useTranslation();

    const token = useAuthStore((s) => s.token);
    const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

    const setSSEStatus = useUIStore((s) => s.setSSEStatus);
    const incrementUnreadComments = useUIStore((s) => s.incrementUnreadComments);
    const incrementUnreadMessages = useUIStore((s) => s.incrementUnreadMessages);

    const esRef = useRef<EventSource | null>(null);
    const retryCountRef = useRef(0);
    const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastToastRef = useRef(0);

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
        (page: string) => router.pathname.includes(page),
        [router.pathname],
    );

    const connect = useCallback(() => {
        if (typeof window === 'undefined') return;
        if (!isAuthenticated) return;

        // Build URL — native needs ?token, web uses cookies
        let url = `${API_URL}/sse/events`;
        if (isNativePlatform() && token) {
            url += `?token=${encodeURIComponent(token)}`;
        }

        const es = new EventSource(url, { withCredentials: true });
        esRef.current = es;

        es.addEventListener('connected', () => {
            retryCountRef.current = 0;
            setSSEStatus('connected');
        });

        // --- Comment events ---
        es.addEventListener('comment:received', (e) => {
            const event: SSEEvent<'comment:received'> = JSON.parse(e.data);
            queryClient.invalidateQueries({ queryKey: ['comments'] });
            queryClient.invalidateQueries({ queryKey: ['comments-stats'] });
            incrementUnreadComments();
            if (!isOnPage('/comments')) {
                showToast(
                    t('sse.newComment', { name: event.data.fromName || '' }),
                    { label: t('sse.view'), onClick: () => router.push('/comments') },
                );
            }
        });

        es.addEventListener('comment:reply_sent', (e) => {
            const event: SSEEvent<'comment:reply_sent'> = JSON.parse(e.data);
            queryClient.invalidateQueries({ queryKey: ['comments'] });
            queryClient.invalidateQueries({ queryKey: ['comments-stats'] });
            if (!isOnPage('/comments') && event.data.replyMethod === 'ai') {
                showToast(t('sse.aiRepliedComment'));
            }
        });

        es.addEventListener('comment:reply_failed', () => {
            queryClient.invalidateQueries({ queryKey: ['comments'] });
            queryClient.invalidateQueries({ queryKey: ['comments-stats'] });
        });

        // --- Message events ---
        es.addEventListener('message:received', (e) => {
            const event: SSEEvent<'message:received'> = JSON.parse(e.data);
            queryClient.invalidateQueries({ queryKey: ['messages'] });
            queryClient.invalidateQueries({ queryKey: ['messages-stats'] });
            incrementUnreadMessages();
            if (!isOnPage('/messages')) {
                showToast(
                    t('sse.newMessage', { name: event.data.senderName || '' }),
                    { label: t('sse.view'), onClick: () => router.push('/messages') },
                );
            }
        });

        es.addEventListener('message:reply_sent', (e) => {
            const event: SSEEvent<'message:reply_sent'> = JSON.parse(e.data);
            queryClient.invalidateQueries({ queryKey: ['messages'] });
            queryClient.invalidateQueries({ queryKey: ['messages-stats'] });
            if (!isOnPage('/messages') && event.data.replyMethod === 'ai') {
                showToast(t('sse.aiRepliedMessage'));
            }
        });

        es.addEventListener('message:reply_failed', () => {
            queryClient.invalidateQueries({ queryKey: ['messages'] });
            queryClient.invalidateQueries({ queryKey: ['messages-stats'] });
        });

        // --- Usage ---
        es.addEventListener('usage:updated', () => {
            queryClient.invalidateQueries({ queryKey: ['subscription-usage'] });
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

            retryTimerRef.current = setTimeout(connect, delay);
        };
    }, [
        isAuthenticated,
        token,
        queryClient,
        setSSEStatus,
        incrementUnreadComments,
        incrementUnreadMessages,
        isOnPage,
        showToast,
        t,
        router,
    ]);

    useEffect(() => {
        if (!isAuthenticated) {
            // Not authenticated — close any existing connection
            if (esRef.current) {
                esRef.current.close();
                esRef.current = null;
            }
            setSSEStatus('disconnected');
            return;
        }

        connect();

        return () => {
            if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
            if (esRef.current) {
                esRef.current.close();
                esRef.current = null;
            }
            setSSEStatus('disconnected');
        };
    }, [isAuthenticated, connect, setSSEStatus]);
}
