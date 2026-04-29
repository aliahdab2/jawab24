import { renderHook, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// ── Router mock (overrides global setup.ts mock so we can control pathname) ───

let mockPathname = '/dashboard';
const mockRouterPush = vi.fn();

vi.mock('next/router', () => ({
    useRouter: () => ({
        push: mockRouterPush,
        replace: vi.fn(),
        prefetch: vi.fn(),
        query: {},
        get pathname() { return mockPathname; },
        locale: 'en',
    }),
}));

// ── Store mocks ───────────────────────────────────────────────────────────────

let mockIsAuthenticated = true;
const mockSetSSEStatus = vi.fn();
const mockIncrementUnreadComments = vi.fn();
const mockIncrementUnreadMessages = vi.fn();
const mockIncrementNewLeads = vi.fn();

vi.mock('@/lib/store', () => ({
    useAuthStore: (selector: (s: { isAuthenticated: boolean }) => unknown) =>
        selector({ isAuthenticated: mockIsAuthenticated }),
    useUIStore: (selector: (s: {
        setSSEStatus: typeof mockSetSSEStatus;
        incrementUnreadComments: typeof mockIncrementUnreadComments;
        incrementUnreadMessages: typeof mockIncrementUnreadMessages;
        incrementNewLeads: typeof mockIncrementNewLeads;
    }) => unknown) =>
        selector({
            setSSEStatus: mockSetSSEStatus,
            incrementUnreadComments: mockIncrementUnreadComments,
            incrementUnreadMessages: mockIncrementUnreadMessages,
            incrementNewLeads: mockIncrementNewLeads,
        }),
}));

// ── React Query mock ──────────────────────────────────────────────────────────

const mockInvalidateQueries = vi.fn();
const mockSetQueriesData = vi.fn();
const mockGetQueryData = vi.fn().mockReturnValue(undefined);

vi.mock('@tanstack/react-query', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@tanstack/react-query')>();
    return {
        ...actual,
        useQueryClient: () => ({
            invalidateQueries: mockInvalidateQueries,
            setQueriesData: mockSetQueriesData,
            getQueryData: mockGetQueryData,
        }),
    };
});

// ── Capacitor mock (web by default) ──────────────────────────────────────────

let mockIsNative = false;
vi.mock('@/lib/capacitor', () => ({
    isNativePlatform: () => mockIsNative,
}));

// ── Toast mock ────────────────────────────────────────────────────────────────

const mockToast = vi.fn();
vi.mock('sonner', () => ({ toast: (...args: unknown[]) => mockToast(...args) }));

// ── EventSource mock ──────────────────────────────────────────────────────────

type EventHandler = (e: { data: string }) => void;

class MockEventSource {
    static instance: MockEventSource | null = null;
    private listeners = new Map<string, EventHandler[]>();
    onerror: ((e: Event) => void) | null = null;

    constructor() {
        MockEventSource.instance = this;
    }

    addEventListener(type: string, handler: EventHandler) {
        if (!this.listeners.has(type)) this.listeners.set(type, []);
        this.listeners.get(type)!.push(handler);
    }

    /** Simulate the server emitting an SSE event (wraps data in the full SSE envelope) */
    dispatch(type: string, data: unknown) {
        const handlers = this.listeners.get(type) ?? [];
        const envelope = { type, timestamp: new Date().toISOString(), data };
        handlers.forEach(h => h({ data: JSON.stringify(envelope) }));
    }

    close() {
        MockEventSource.instance = null;
    }
}

// Install global mock — jsdom doesn't implement EventSource
global.EventSource = MockEventSource as unknown as typeof EventSource;

// ── Helper ────────────────────────────────────────────────────────────────────

async function mountSSE() {
    const { useSSE } = await import('@/hooks/useSSE');
    const hook = renderHook(() => useSSE());
    // Flush effects so EventSource is created and listeners are registered
    await act(async () => {});
    return hook;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('useSSE', () => {
    let unmount: () => void = () => {};

    beforeEach(() => {
        mockIsAuthenticated = true;
        mockIsNative = false;
        mockPathname = '/dashboard';
        MockEventSource.instance = null;
        vi.clearAllMocks();
    });

    afterEach(() => {
        unmount();
        unmount = () => {};
    });

    // ── Connection lifecycle ───────────────────────────────────────────────────

    it('does not create EventSource when not authenticated', async () => {
        mockIsAuthenticated = false;
        const { unmount: u } = await mountSSE();
        unmount = u;

        expect(MockEventSource.instance).toBeNull();
    });

    it('creates EventSource when authenticated on web', async () => {
        const { unmount: u } = await mountSSE();
        unmount = u;

        expect(MockEventSource.instance).not.toBeNull();
    });

    it('sets SSE status to connected when connected event fires', async () => {
        const { unmount: u } = await mountSSE();
        unmount = u;

        act(() => { MockEventSource.instance!.dispatch('connected', {}); });

        expect(mockSetSSEStatus).toHaveBeenCalledWith('connected');
    });

    // ── comment:received — ON comments page ───────────────────────────────────

    it('comment:received ON /comments → invalidates both comments list and stats', async () => {
        mockPathname = '/comments';
        const { unmount: u } = await mountSSE();
        unmount = u;

        act(() => {
            MockEventSource.instance!.dispatch('comment:received', {
                commentId: 'c1', pageId: 'p1', fromName: 'Ali', message: 'Hello',
            });
        });

        expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['comments-stats'] });
        expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['comments'] });
    });

    it('comment:received ON /comments → does NOT show toast or increment unread', async () => {
        mockPathname = '/comments';
        const { unmount: u } = await mountSSE();
        unmount = u;

        act(() => {
            MockEventSource.instance!.dispatch('comment:received', {
                commentId: 'c1', pageId: 'p1', fromName: 'Ali', message: 'Hello',
            });
        });

        expect(mockIncrementUnreadComments).not.toHaveBeenCalled();
        expect(mockToast).not.toHaveBeenCalled();
    });

    // ── comment:received — OFF comments page ─────────────────────────────────

    it('comment:received NOT on /comments → only invalidates stats, NOT list', async () => {
        mockPathname = '/dashboard'; // not on comments
        const { unmount: u } = await mountSSE();
        unmount = u;

        act(() => {
            MockEventSource.instance!.dispatch('comment:received', {
                commentId: 'c1', pageId: 'p1', fromName: 'Ali', message: 'Hello',
            });
        });

        expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['comments-stats'] });
        // The list must NOT be invalidated when user is not on the comments page
        expect(mockInvalidateQueries).not.toHaveBeenCalledWith({ queryKey: ['comments'] });
    });

    it('comment:received NOT on /comments → increments unread count and shows toast', async () => {
        mockPathname = '/dashboard';
        // isActivePageId returns true when pages cache is undefined (default) — no extra setup needed
        const { unmount: u } = await mountSSE();
        unmount = u;

        act(() => {
            MockEventSource.instance!.dispatch('comment:received', {
                commentId: 'c1', pageId: 'p1', fromName: 'Noor', message: 'Hi!',
            });
        });

        expect(mockIncrementUnreadComments).toHaveBeenCalledTimes(1);
        expect(mockToast).toHaveBeenCalledTimes(1);
    });

    // ── comment:reply_sent ────────────────────────────────────────────────────

    it('comment:reply_sent → always invalidates comments-stats', async () => {
        const { unmount: u } = await mountSSE();
        unmount = u;

        act(() => {
            MockEventSource.instance!.dispatch('comment:reply_sent', {
                commentId: 'c1', pageId: 'p1', replyMethod: 'ai', replyText: 'Thanks!',
            });
        });

        expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['comments-stats'] });
    });

    it('comment:reply_sent on /comments → invalidates the comments list so server-filtered tabs (Needs Action) re-fetch', async () => {
        mockPathname = '/comments';
        const { unmount: u } = await mountSSE();
        unmount = u;

        act(() => {
            MockEventSource.instance!.dispatch('comment:reply_sent', {
                commentId: 'c1', pageId: 'p1', replyMethod: 'ai', replyText: 'Thanks!',
            });
        });

        expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['comments'] });
        // No surgical patching — invalidation is the new contract.
        expect(mockSetQueriesData).not.toHaveBeenCalledWith(
            { queryKey: ['comments'] },
            expect.any(Function),
        );
    });

    it('comment:reply_sent NOT on /comments → does not invalidate the comments list (badge stats handled separately)', async () => {
        mockPathname = '/dashboard';
        const { unmount: u } = await mountSSE();
        unmount = u;

        act(() => {
            MockEventSource.instance!.dispatch('comment:reply_sent', {
                commentId: 'c1', pageId: 'p1', replyMethod: 'ai', replyText: 'Thanks!',
            });
        });

        expect(mockInvalidateQueries).not.toHaveBeenCalledWith({ queryKey: ['comments'] });
        expect(mockSetQueriesData).not.toHaveBeenCalledWith(
            { queryKey: ['comments'] },
            expect.any(Function),
        );
    });

    it('comment:reply_sent ai + NOT on /comments → shows toast', async () => {
        mockPathname = '/dashboard';
        const { unmount: u } = await mountSSE();
        unmount = u;

        act(() => {
            MockEventSource.instance!.dispatch('comment:reply_sent', {
                commentId: 'c1', pageId: 'p1', replyMethod: 'ai', replyText: 'Sure!',
            });
        });

        expect(mockToast).toHaveBeenCalledTimes(1);
    });

    it('comment:reply_sent template + NOT on /comments → no toast', async () => {
        mockPathname = '/dashboard';
        const { unmount: u } = await mountSSE();
        unmount = u;

        act(() => {
            MockEventSource.instance!.dispatch('comment:reply_sent', {
                commentId: 'c1', pageId: 'p1', replyMethod: 'template', replyText: 'Sure!',
            });
        });

        expect(mockToast).not.toHaveBeenCalled();
    });

    // ── comment:reply_failed ──────────────────────────────────────────────────

    it('comment:reply_failed ON /comments → invalidates both list and stats', async () => {
        mockPathname = '/comments';
        const { unmount: u } = await mountSSE();
        unmount = u;

        act(() => { MockEventSource.instance!.dispatch('comment:reply_failed', {}); });

        expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['comments-stats'] });
        expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['comments'] });
    });

    it('comment:reply_failed NOT on /comments → only invalidates stats', async () => {
        mockPathname = '/dashboard';
        const { unmount: u } = await mountSSE();
        unmount = u;

        act(() => { MockEventSource.instance!.dispatch('comment:reply_failed', {}); });

        expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['comments-stats'] });
        expect(mockInvalidateQueries).not.toHaveBeenCalledWith({ queryKey: ['comments'] });
    });

    // ── message:received ──────────────────────────────────────────────────────

    it('message:received ON /messages → invalidates both list and stats', async () => {
        mockPathname = '/messages';
        const { unmount: u } = await mountSSE();
        unmount = u;

        act(() => {
            MockEventSource.instance!.dispatch('message:received', {
                messageId: 'm1', pageId: 'p1', senderId: 's1', senderName: 'Ali',
            });
        });

        expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['messages-stats'] });
        expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['messages'] });
    });

    it('message:received NOT on /messages → only invalidates stats, NOT list', async () => {
        mockPathname = '/dashboard';
        const { unmount: u } = await mountSSE();
        unmount = u;

        act(() => {
            MockEventSource.instance!.dispatch('message:received', {
                messageId: 'm1', pageId: 'p1', senderId: 's1', senderName: 'Ali',
            });
        });

        expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['messages-stats'] });
        expect(mockInvalidateQueries).not.toHaveBeenCalledWith({ queryKey: ['messages'] });
    });

    // ── message:reply_sent ────────────────────────────────────────────────────

    it('message:reply_sent ON /messages → invalidates both list and stats', async () => {
        mockPathname = '/messages';
        const { unmount: u } = await mountSSE();
        unmount = u;

        act(() => {
            MockEventSource.instance!.dispatch('message:reply_sent', {
                messageId: 'm1', pageId: 'p1', replyMethod: 'ai', replyText: 'Hello!',
            });
        });

        expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['messages-stats'] });
        expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['messages'] });
    });

    it('message:reply_sent NOT on /messages → only invalidates stats', async () => {
        mockPathname = '/dashboard';
        const { unmount: u } = await mountSSE();
        unmount = u;

        act(() => {
            MockEventSource.instance!.dispatch('message:reply_sent', {
                messageId: 'm1', pageId: 'p1', replyMethod: 'ai', replyText: 'Hello!',
            });
        });

        expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['messages-stats'] });
        expect(mockInvalidateQueries).not.toHaveBeenCalledWith({ queryKey: ['messages'] });
    });

    // ── message:reply_failed ──────────────────────────────────────────────────

    it('message:reply_failed ON /messages → invalidates list, conversation, and stats', async () => {
        mockPathname = '/messages';
        const { unmount: u } = await mountSSE();
        unmount = u;

        act(() => { MockEventSource.instance!.dispatch('message:reply_failed', {}); });

        expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['messages-stats'] });
        expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['messages'] });
        expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['conversation'] });
    });

    it('message:reply_failed NOT on /messages → only invalidates stats', async () => {
        mockPathname = '/dashboard';
        const { unmount: u } = await mountSSE();
        unmount = u;

        act(() => { MockEventSource.instance!.dispatch('message:reply_failed', {}); });

        expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['messages-stats'] });
        expect(mockInvalidateQueries).not.toHaveBeenCalledWith({ queryKey: ['messages'] });
        expect(mockInvalidateQueries).not.toHaveBeenCalledWith({ queryKey: ['conversation'] });
    });

    // ── lead:captured ─────────────────────────────────────────────────────────

    it('lead:captured ON /leads → invalidates both list and count', async () => {
        mockPathname = '/leads';
        const { unmount: u } = await mountSSE();
        unmount = u;

        act(() => {
            MockEventSource.instance!.dispatch('lead:captured', {
                leadId: 'l1', pageId: 'p1', senderName: 'Noor', phone: '+966500000000',
            });
        });

        expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['leads-count'] });
        expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['leads'] });
    });

    it('lead:captured NOT on /leads → only invalidates count, shows toast, increments unread', async () => {
        mockPathname = '/dashboard';
        const { unmount: u } = await mountSSE();
        unmount = u;

        act(() => {
            MockEventSource.instance!.dispatch('lead:captured', {
                leadId: 'l1', pageId: 'p1', senderName: 'Noor', phone: '+966500000000',
            });
        });

        expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['leads-count'] });
        expect(mockInvalidateQueries).not.toHaveBeenCalledWith({ queryKey: ['leads'] });
        expect(mockIncrementNewLeads).toHaveBeenCalledTimes(1);
        expect(mockToast).toHaveBeenCalledTimes(1);
    });

    // ── Resilience ────────────────────────────────────────────────────────────

    it('malformed comment:received JSON does not throw', async () => {
        const { unmount: u } = await mountSSE();
        unmount = u;

        expect(() => {
            act(() => {
                const handlers = (MockEventSource.instance as unknown as {
                    listeners: Map<string, Array<(e: { data: string }) => void>>;
                }).listeners.get('comment:received') ?? [];
                handlers.forEach(h => h({ data: 'not-valid-json' }));
            });
        }).not.toThrow();
    });
});
