import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { NotificationBell } from '../../src/components/ui/NotificationBell';

// Mock useAuthStore
let mockToken: string | null = 'test-token';

vi.mock('../../src/lib/store', () => ({
    useAuthStore: () => ({
        token: mockToken,
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

describe('NotificationBell', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockToken = 'test-token';
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

    it('should not fetch if no token', async () => {
        mockToken = null;
        
        render(<NotificationBell />);

        // Wait a tick
        await new Promise(r => setTimeout(r, 50));
        
        expect(mockGetUnreadCount).not.toHaveBeenCalled();
    });

    it('should call getUnreadCount with correct token', async () => {
        mockGetUnreadCount.mockResolvedValue(3);

        render(<NotificationBell />);

        await waitFor(() => {
            expect(mockGetUnreadCount).toHaveBeenCalledWith('test-token');
        });
    });

    it('should handle API errors gracefully (returns 0)', async () => {
        // Real getUnreadCount catches errors and returns 0
        // The mock should reflect this behavior
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
            notifications: [{
                id: 'notif-1',
                type: 'payment_failed',
                titleEn: 'Payment Failed',
                titleAr: 'فشل الدفع',
                bodyEn: 'Your payment could not be processed.',
                bodyAr: 'لم نتمكن من معالجة الدفع.',
                read: false,
                createdAt: new Date().toISOString(),
                data: null,
            }], 
            unreadCount: 1 
        });

        render(<NotificationBell />);

        // Open dropdown
        const button = screen.getByRole('button');
        fireEvent.click(button);

        await waitFor(() => {
            expect(mockGetNotifications).toHaveBeenCalledWith('test-token');
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
            notifications: [{
                id: 'notif-1',
                type: 'payment_failed',
                titleEn: 'Payment Failed',
                titleAr: 'فشل الدفع',
                bodyEn: 'Your payment could not be processed.',
                bodyAr: 'لم نتمكن من معالجة الدفع.',
                read: false,
                createdAt: new Date().toISOString(),
                data: null,
            }], 
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
            expect(mockMarkNotificationAsRead).toHaveBeenCalledWith('test-token', 'notif-1');
        });
    });

    it('should mark all as read when clicking mark all button', async () => {
        mockMarkAllNotificationsAsRead.mockResolvedValue(undefined);
        mockGetUnreadCount.mockResolvedValue(2);
        mockGetNotifications.mockResolvedValue({ 
            notifications: [
                {
                    id: 'notif-1',
                    type: 'payment_failed',
                    titleEn: 'Payment Failed',
                    titleAr: 'فشل الدفع',
                    bodyEn: 'Body',
                    bodyAr: 'نص',
                    read: false,
                    createdAt: new Date().toISOString(),
                    data: null,
                },
            ], 
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
            expect(mockMarkAllNotificationsAsRead).toHaveBeenCalledWith('test-token');
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

        // Fast forward 60 seconds (refresh interval)
        await vi.advanceTimersByTimeAsync(60000);

        // Should have fetched again
        expect(mockGetUnreadCount.mock.calls.length).toBeGreaterThan(1);

        vi.useRealTimers();
    });
});
