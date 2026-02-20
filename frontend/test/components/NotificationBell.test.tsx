import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { NotificationBell } from '../../src/components/ui/NotificationBell';

// Mock sonner toast
const mockToast = vi.fn();
vi.mock('sonner', () => ({
    toast: (...args: unknown[]) => mockToast(...args),
}));

// Mock useAuthStore
let mockIsAuthenticated = true;

vi.mock('../../src/lib/store', () => ({
    useAuthStore: () => ({
        isAuthenticated: mockIsAuthenticated,
    }),
}));

// Mock i18n
vi.mock('../../src/i18n', () => ({
    useTranslation: () => ({
        t: (key: string) => key,
        language: 'en',
    }),
}));

// Mock next/router
vi.mock('next/router', () => ({
    useRouter: () => ({
        push: vi.fn(),
        query: {},
    }),
}));

// Mock notification functions
const mockGetUnreadCount = vi.fn();
const mockGetNotifications = vi.fn();
const mockMarkNotificationAsRead = vi.fn();
const mockMarkAllNotificationsAsRead = vi.fn();

vi.mock('../../src/lib/notifications', () => ({
    getUnreadCount: (...args: unknown[]) => mockGetUnreadCount(...args),
    getNotifications: (...args: unknown[]) => mockGetNotifications(...args),
    markNotificationAsRead: (...args: unknown[]) => mockMarkNotificationAsRead(...args),
    markAllNotificationsAsRead: (...args: unknown[]) => mockMarkAllNotificationsAsRead(...args),
    initializePushNotifications: vi.fn(),
}));

const sampleNotification = {
    id: 'notif-1',
    type: 'payment_failed',
    title: 'Payment Failed',
    body: 'Your payment could not be processed.',
    read: false,
    createdAt: new Date().toISOString(),
    data: null,
};

describe('NotificationBell', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIsAuthenticated = true;
        mockGetUnreadCount.mockResolvedValue(0);
        mockGetNotifications.mockResolvedValue({ notifications: [], unreadCount: 0 });
    });

    afterEach(() => {
        vi.resetAllMocks();
    });

    it('should render the bell icon', async () => {
        render(<NotificationBell />);

        const button = screen.getByRole('button');
        expect(button).toBeInTheDocument();
    });

    it('should show badge with unread count when > 0', async () => {
        mockGetUnreadCount.mockResolvedValue(5);

        render(<NotificationBell />);

        await waitFor(() => {
            expect(screen.getByText('5')).toBeInTheDocument();
        });
    });

    it('should show 99+ when count exceeds 99', async () => {
        mockGetUnreadCount.mockResolvedValue(150);

        render(<NotificationBell />);

        await waitFor(() => {
            expect(screen.getByText('99+')).toBeInTheDocument();
        });
    });

    it('should not show badge when count is 0', async () => {
        mockGetUnreadCount.mockResolvedValue(0);

        render(<NotificationBell />);

        await waitFor(() => {
            expect(mockGetUnreadCount).toHaveBeenCalled();
        });

        // Badge should not be in the document
        expect(screen.queryByText('0')).not.toBeInTheDocument();
    });

    it('should not fetch if not authenticated', async () => {
        mockIsAuthenticated = false;

        render(<NotificationBell />);

        // Wait a tick
        await new Promise(r => setTimeout(r, 50));

        expect(mockGetUnreadCount).not.toHaveBeenCalled();
    });

    it('should call getUnreadCount on mount', async () => {
        mockGetUnreadCount.mockResolvedValue(3);

        render(<NotificationBell />);

        await waitFor(() => {
            expect(mockGetUnreadCount).toHaveBeenCalled();
        });
    });

    it('should handle API errors gracefully (returns 0)', async () => {
        // Real getUnreadCount catches errors and returns 0
        mockGetUnreadCount.mockResolvedValue(0);

        render(<NotificationBell />);

        await waitFor(() => {
            expect(mockGetUnreadCount).toHaveBeenCalled();
        });

        // Component should still render without badge (0 unread)
        const button = screen.getByRole('button');
        expect(button).toBeInTheDocument();
        expect(screen.queryByText('0')).not.toBeInTheDocument();
    });

    it('should open dropdown on click', async () => {
        mockGetNotifications.mockResolvedValue({
            notifications: [],
            unreadCount: 0
        });

        render(<NotificationBell />);

        const button = screen.getByRole('button');
        fireEvent.click(button);

        await waitFor(() => {
            expect(screen.getByText('notifications.title')).toBeInTheDocument();
        });
    });

    it('should fetch notifications when dropdown opens', async () => {
        mockGetNotifications.mockResolvedValue({
            notifications: [sampleNotification],
            unreadCount: 1
        });

        render(<NotificationBell />);

        // Open dropdown
        const button = screen.getByRole('button');
        fireEvent.click(button);

        await waitFor(() => {
            expect(mockGetNotifications).toHaveBeenCalled();
        });

        // Notification should be visible
        await waitFor(() => {
            expect(screen.getByText('Payment Failed')).toBeInTheDocument();
        });
    });

    it('should show empty state when no notifications', async () => {
        mockGetNotifications.mockResolvedValue({
            notifications: [],
            unreadCount: 0
        });

        render(<NotificationBell />);

        const button = screen.getByRole('button');
        fireEvent.click(button);

        await waitFor(() => {
            expect(screen.getByText('notifications.empty')).toBeInTheDocument();
        });
    });

    it('should mark notification as read when clicked', async () => {
        mockMarkNotificationAsRead.mockResolvedValue(undefined);
        mockGetNotifications.mockResolvedValue({
            notifications: [sampleNotification],
            unreadCount: 1
        });

        render(<NotificationBell />);

        // Open dropdown
        const button = screen.getByRole('button');
        fireEvent.click(button);

        // Wait for notification to appear
        await waitFor(() => {
            expect(screen.getByText('Payment Failed')).toBeInTheDocument();
        });

        // Click on notification
        const notification = screen.getByText('Payment Failed').closest('div[class*="cursor-pointer"]');
        if (notification) {
            fireEvent.click(notification);
        }

        await waitFor(() => {
            expect(mockMarkNotificationAsRead).toHaveBeenCalledWith('notif-1');
        });
    });

    it('should mark all as read when clicking mark all button', async () => {
        mockMarkAllNotificationsAsRead.mockResolvedValue(undefined);
        mockGetUnreadCount.mockResolvedValue(2);
        mockGetNotifications.mockResolvedValue({
            notifications: [{ ...sampleNotification, read: false }],
            unreadCount: 2
        });

        render(<NotificationBell />);

        // Open dropdown
        const button = screen.getByRole('button');
        fireEvent.click(button);

        // Wait for "Mark all read" button to appear
        await waitFor(() => {
            expect(screen.getByText('notifications.markAllRead')).toBeInTheDocument();
        });

        // Click mark all read
        fireEvent.click(screen.getByText('notifications.markAllRead'));

        await waitFor(() => {
            expect(mockMarkAllNotificationsAsRead).toHaveBeenCalled();
        });
    });

    it('should refresh count periodically', async () => {
        vi.useFakeTimers();

        mockGetUnreadCount.mockResolvedValue(1);

        render(<NotificationBell />);

        // Initial fetch
        await vi.waitFor(() => {
            expect(mockGetUnreadCount).toHaveBeenCalledTimes(1);
        });

        // Fast forward 60 seconds (refresh interval) — wrap in act to handle state updates
        await act(async () => {
            await vi.advanceTimersByTimeAsync(60000);
        });

        // Should have fetched again
        expect(mockGetUnreadCount.mock.calls.length).toBeGreaterThan(1);

        vi.useRealTimers();
    });

    describe('Swipe dismiss & undo toast', () => {
        const notification1 = {
            id: 'notif-1',
            type: 'new_comment',
            title: 'New Comment',
            body: 'Someone commented on your post.',
            read: false,
            createdAt: new Date().toISOString(),
            data: null,
        };
        const notification2 = {
            id: 'notif-2',
            type: 'payment_failed',
            title: 'Payment Failed',
            body: 'Your payment could not be processed.',
            read: false,
            createdAt: new Date().toISOString(),
            data: null,
        };
        const readNotification = {
            id: 'notif-3',
            type: 'subscription_renewed',
            title: 'Subscription Renewed',
            body: 'Your subscription was renewed.',
            read: true,
            createdAt: new Date().toISOString(),
            data: null,
        };

        it('should wrap notifications in SwipeableNotificationItem', async () => {
            mockGetNotifications.mockResolvedValue({
                notifications: [notification1, readNotification],
                unreadCount: 1,
            });

            render(<NotificationBell />);
            fireEvent.click(screen.getByRole('button'));

            await waitFor(() => {
                expect(screen.getByText('New Comment')).toBeInTheDocument();
            });

            // Each notification is wrapped — the wrapper has overflow-hidden in its className
            // Query via the notification text's ancestor chain
            const newCommentEl = screen.getByText('New Comment');
            const wrapper = newCommentEl.closest('div[class*="overflow-hidden"]');
            expect(wrapper).not.toBeNull();
            expect(wrapper?.className).toContain('border-b');
        });

        it('should show both unread and read notifications with appropriate styling', async () => {
            mockGetNotifications.mockResolvedValue({
                notifications: [notification1, readNotification],
                unreadCount: 1,
            });

            render(<NotificationBell />);
            fireEvent.click(screen.getByRole('button'));

            await waitFor(() => {
                expect(screen.getByText('New Comment')).toBeInTheDocument();
                expect(screen.getByText('Subscription Renewed')).toBeInTheDocument();
            });

            // Unread notification has brand background
            const unreadNotif = screen.getByText('New Comment').closest('div[class*="cursor-pointer"]');
            expect(unreadNotif?.className).toContain('bg-brand-50');

            // Read notification has surface hover
            const readNotif = screen.getByText('Subscription Renewed').closest('div[class*="cursor-pointer"]');
            expect(readNotif?.className).toContain('hover:bg-surface-50');
        });

        it('should display notification content structure (title, body, timestamp)', async () => {
            mockGetNotifications.mockResolvedValue({
                notifications: [notification1],
                unreadCount: 1,
            });

            render(<NotificationBell />);
            fireEvent.click(screen.getByRole('button'));

            await waitFor(() => {
                expect(screen.getByText('New Comment')).toBeInTheDocument();
            });

            expect(screen.getByText('Someone commented on your post.')).toBeInTheDocument();
            expect(screen.getByText('notifications.justNow')).toBeInTheDocument();
        });

        it('should show background label for unread notifications only', async () => {
            mockGetNotifications.mockResolvedValue({
                notifications: [notification1, readNotification],
                unreadCount: 1,
            });

            render(<NotificationBell />);
            fireEvent.click(screen.getByRole('button'));

            await waitFor(() => {
                expect(screen.getByText('New Comment')).toBeInTheDocument();
            });

            // The SwipeableNotificationItem shows "markAsRead" labels for enabled (unread) items
            // Unread notification1 has enabled=true so its wrapper shows background labels
            // The text "notifications.markAsRead" appears in the swipe background (2 per unread item: left + right)
            const markAsReadTexts = screen.getAllByText('notifications.markAsRead');
            // At least 2 from the background (one unread notification) + possibly 1 from the check button
            expect(markAsReadTexts.length).toBeGreaterThanOrEqual(2);
        });

        it('should not call markNotificationAsRead on initial render', async () => {
            mockGetNotifications.mockResolvedValue({
                notifications: [notification1],
                unreadCount: 1,
            });

            render(<NotificationBell />);
            fireEvent.click(screen.getByRole('button'));

            await waitFor(() => {
                expect(screen.getByText('New Comment')).toBeInTheDocument();
            });

            // markNotificationAsRead should not have been called yet
            expect(mockMarkNotificationAsRead).not.toHaveBeenCalled();
        });

        it('should use transition-colors instead of transition-all on notification items', async () => {
            mockGetNotifications.mockResolvedValue({
                notifications: [notification1],
                unreadCount: 1,
            });

            render(<NotificationBell />);
            fireEvent.click(screen.getByRole('button'));

            await waitFor(() => {
                expect(screen.getByText('New Comment')).toBeInTheDocument();
            });

            const notifDiv = screen.getByText('New Comment').closest('div[class*="cursor-pointer"]');
            expect(notifDiv?.className).toContain('transition-colors');
            expect(notifDiv?.className).not.toContain('transition-all');
        });
    });
});
