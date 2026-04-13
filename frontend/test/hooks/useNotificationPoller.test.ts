import { renderHook, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

let mockIsAuthenticated = true;
const mockSetNotificationUnreadCount = vi.fn();

vi.mock('@/lib/store', () => ({
    useAuthStore: () => ({ isAuthenticated: mockIsAuthenticated }),
    useUIStore: (selector: (s: { setNotificationUnreadCount: typeof mockSetNotificationUnreadCount }) => unknown) =>
        selector({ setNotificationUnreadCount: mockSetNotificationUnreadCount }),
}));

const mockGetUnreadCount = vi.fn();
vi.mock('@/lib/notifications', () => ({
    getUnreadCount: (...args: unknown[]) => mockGetUnreadCount(...args),
}));

const mockCaptureError = vi.fn();
vi.mock('@/lib/sentryHelpers', () => ({
    captureError: (...args: unknown[]) => mockCaptureError(...args),
    addErrorBreadcrumb: vi.fn(),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 60_000;
const CIRCUIT_BREAKER_THRESHOLD = 3;

async function mountPoller() {
    const { useNotificationPoller } = await import('@/hooks/useNotificationPoller');
    return renderHook(() => useNotificationPoller());
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('useNotificationPoller', () => {
    let unmount: () => void = () => {};

    beforeEach(() => {
        vi.useFakeTimers();
        mockIsAuthenticated = true;
        mockGetUnreadCount.mockResolvedValue({ count: 0 });
        vi.clearAllMocks();
    });

    afterEach(() => {
        unmount();
        unmount = () => {};
        vi.useRealTimers();
    });

    // ── Authentication guard ───────────────────────────────────────────────────

    it('does not fetch when not authenticated', async () => {
        mockIsAuthenticated = false;
        const { unmount: u } = await mountPoller();
        unmount = u;

        await act(async () => {});

        expect(mockGetUnreadCount).not.toHaveBeenCalled();
    });

    // ── Initial fetch ─────────────────────────────────────────────────────────

    it('fetches unread count immediately on mount', async () => {
        mockGetUnreadCount.mockResolvedValue({ count: 7 });
        const { unmount: u } = await mountPoller();
        unmount = u;

        await act(async () => {});

        expect(mockGetUnreadCount).toHaveBeenCalledTimes(1);
        expect(mockSetNotificationUnreadCount).toHaveBeenCalledWith(7);
    });

    // ── Polling interval ─────────────────────────────────────────────────────

    it('polls again after POLL_INTERVAL_MS', async () => {
        mockGetUnreadCount.mockResolvedValue({ count: 3 });
        const { unmount: u } = await mountPoller();
        unmount = u;

        // Initial fetch
        await act(async () => {});
        expect(mockGetUnreadCount).toHaveBeenCalledTimes(1);

        // Advance past poll interval
        await act(async () => {
            await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
        });

        expect(mockGetUnreadCount).toHaveBeenCalledTimes(2);
    });

    // ── retryAfter backoff ────────────────────────────────────────────────────

    it('uses retryAfter from response as next poll delay', async () => {
        // First call: server says retry after 120 seconds
        mockGetUnreadCount.mockResolvedValueOnce({ count: 0, retryAfter: 120 });
        mockGetUnreadCount.mockResolvedValue({ count: 0 });

        const { unmount: u } = await mountPoller();
        unmount = u;

        await act(async () => {});
        expect(mockGetUnreadCount).toHaveBeenCalledTimes(1);

        // Normal interval passes — should NOT poll yet (delay is 120s)
        await act(async () => {
            await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
        });
        expect(mockGetUnreadCount).toHaveBeenCalledTimes(1);

        // Full retryAfter delay passes — now it should poll
        await act(async () => {
            await vi.advanceTimersByTimeAsync(120_000 - POLL_INTERVAL_MS);
        });
        expect(mockGetUnreadCount).toHaveBeenCalledTimes(2);
    });

    // ── Error handling & circuit breaker ────────────────────────────────────

    it('resets consecutive error count on success', async () => {
        mockGetUnreadCount
            .mockRejectedValueOnce(new Error('network error'))
            .mockResolvedValue({ count: 2 });

        const { unmount: u } = await mountPoller();
        unmount = u;

        // Initial call fails
        await act(async () => {});

        // Retry after interval — succeeds this time
        await act(async () => {
            await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
        });

        expect(mockSetNotificationUnreadCount).toHaveBeenCalledWith(2);
        // Verify polling continues (error count was reset)
        await act(async () => {
            await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
        });
        expect(mockGetUnreadCount).toHaveBeenCalledTimes(3);
    });

    it('stops polling after 3 consecutive errors (circuit breaker)', async () => {
        mockGetUnreadCount.mockRejectedValue(new Error('backend down'));

        const { unmount: u } = await mountPoller();
        unmount = u;

        // Initial call + 2 retries = 3 total failures → circuit trips
        await act(async () => {});
        await act(async () => { await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS); });
        await act(async () => { await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS); });

        expect(mockGetUnreadCount).toHaveBeenCalledTimes(CIRCUIT_BREAKER_THRESHOLD);

        // Further time passes — circuit is open, no more calls
        await act(async () => { await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 5); });
        expect(mockGetUnreadCount).toHaveBeenCalledTimes(CIRCUIT_BREAKER_THRESHOLD);
    });

    it('reports to Sentry when circuit breaker trips', async () => {
        mockGetUnreadCount.mockRejectedValue(new Error('backend down'));

        const { unmount: u } = await mountPoller();
        unmount = u;

        await act(async () => {});
        await act(async () => { await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS); });
        await act(async () => { await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS); });

        expect(mockCaptureError).toHaveBeenCalledTimes(1);
        expect(mockCaptureError).toHaveBeenCalledWith(
            expect.any(Error),
            expect.stringContaining('circuit breaker'),
            expect.objectContaining({ level: 'error' }),
        );
    });

    // ── Singleton behavior ────────────────────────────────────────────────────

    it('only the first mounted instance fetches — second is a no-op', async () => {
        mockGetUnreadCount.mockResolvedValue({ count: 1 });

        const { unmount: u1 } = await mountPoller();
        const { unmount: u2 } = await mountPoller();

        unmount = () => { u1(); u2(); };

        await act(async () => {});
        await act(async () => { await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS); });

        // Both instances mount, but only ONE set of fetches happens
        expect(mockGetUnreadCount).toHaveBeenCalledTimes(2); // initial + 1 poll
    });

    // ── Cleanup ───────────────────────────────────────────────────────────────

    it('cancels pending poll timer on unmount', async () => {
        mockGetUnreadCount.mockResolvedValue({ count: 0 });

        const { unmount: u } = await mountPoller();
        await act(async () => {});
        expect(mockGetUnreadCount).toHaveBeenCalledTimes(1);

        // Unmount before interval fires
        act(() => { u(); });
        unmount = () => {};

        // Timer should have been cancelled — no more fetches
        await act(async () => { await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3); });
        expect(mockGetUnreadCount).toHaveBeenCalledTimes(1);
    });
});
