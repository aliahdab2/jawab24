 
import { Capacitor } from '@capacitor/core';
import { PushNotifications, Token, ActionPerformed, PushNotificationSchema } from '@capacitor/push-notifications';
import axios from 'axios';
import { toast } from 'sonner';
import { api } from './api';
import { captureError, addErrorBreadcrumb } from '@/lib/sentryHelpers';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://jawab24.com/api';

const PERM_DISMISSED_KEY = 'push_prompt_dismissed_at';
const PERM_GRANTED_KEY = 'push_permission_granted';
const DISMISS_COOLDOWN_DAYS = 7;

/**
 * Check if we should show the pre-prompt to the user.
 * Uses localStorage only — does NOT call any Capacitor Push API to avoid
 * triggering the Android 13+ system permission dialog prematurely.
 */
export function shouldShowNotificationPrePrompt(): boolean {
    if (!Capacitor.isNativePlatform()) return false;

    // Already granted or user completed the flow before
    if (localStorage.getItem(PERM_GRANTED_KEY) === 'true') return false;

    // User dismissed the pre-prompt recently
    const dismissedAt = localStorage.getItem(PERM_DISMISSED_KEY);
    if (dismissedAt) {
        const daysSince = (Date.now() - Number(dismissedAt)) / (1000 * 60 * 60 * 24);
        if (daysSince < DISMISS_COOLDOWN_DAYS) return false;
    }

    return true;
}

/**
 * Record that the user tapped "Not now" on the pre-prompt.
 */
export function dismissNotificationPrePrompt(): void {
    localStorage.setItem(PERM_DISMISSED_KEY, String(Date.now()));
}

/**
 * Request notification permission and register for push.
 * Call this ONLY after user taps "Enable" on the pre-prompt.
 * This is the ONLY place that calls Capacitor Push APIs for permission.
 */
export async function requestAndRegisterPush(authToken: string): Promise<boolean> {
    if (!Capacitor.isNativePlatform()) return false;

    try {
        const permResult = await PushNotifications.requestPermissions();
        if (permResult.receive !== 'granted') return false;

        // Store granted flag so we never show pre-prompt again
        // and can silently re-register on subsequent launches
        localStorage.setItem(PERM_GRANTED_KEY, 'true');

        await registerPushListeners(authToken);
        return true;
    } catch (error) {
        console.error('[Push] Permission request error:', error);
        captureError(error, 'Push permission request error', { tags: { context: 'push' } });
        return false;
    }
}

/**
 * Initialize push notifications for native platforms.
 * Only sets up listeners if user previously granted permission (checked via localStorage).
 * Does NOT call checkPermissions() to avoid triggering Android 13+ system dialog.
 */
export async function initPushNotifications(token: string): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;

    // Only proceed if we know permission was previously granted
    if (localStorage.getItem(PERM_GRANTED_KEY) !== 'true') return;

    try {
        await registerPushListeners(token);
    } catch (error) {
        console.error('[Push] Init error:', error);
        captureError(error, 'Push init error', { tags: { context: 'push' } });
    }
}

/**
 * Internal: register for push and set up all listeners.
 */
async function registerPushListeners(authToken: string): Promise<void> {
    await PushNotifications.register();

    PushNotifications.addListener('registration', async (tokenData: Token) => {
        await registerTokenWithBackend(authToken, tokenData.value);
    });

    PushNotifications.addListener('registrationError', (error) => {
        captureError(error, 'Push registration error', { tags: { context: 'push-registration' } });
    });

    PushNotifications.addListener('pushNotificationReceived', (notification: PushNotificationSchema) => {
        handleForegroundNotification(notification);
    });

    PushNotifications.addListener('pushNotificationActionPerformed', (action: ActionPerformed) => {
        handleNotificationTap(action);
    });
}

/**
 * Register FCM token with backend
 */
async function registerTokenWithBackend(authToken: string, fcmToken: string): Promise<void> {
    try {
        const platform = Capacitor.getPlatform() as 'android' | 'ios' | 'web';
        
        await axios.post(
            `${API_URL}/notifications/register-token`,
            { token: fcmToken, platform },
            { headers: { Authorization: `Bearer ${authToken}` } }
        );
        
        // Store token locally to detect changes
        if (typeof window !== 'undefined') {
            localStorage.setItem('fcm_token', fcmToken);
        }
    } catch (error) {
        captureError(error, 'Failed to register push token with backend', { tags: { context: 'push' } });
    }
}

/**
 * Remove FCM token from backend (call on logout)
 */
export async function removePushToken(authToken: string): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
        return;
    }

    try {
        const fcmToken = localStorage.getItem('fcm_token');
        if (fcmToken) {
            await axios.post(
                `${API_URL}/notifications/remove-token`,
                { token: fcmToken },
                { headers: { Authorization: `Bearer ${authToken}` } }
            );
            localStorage.removeItem('fcm_token');
        }
    } catch {
        addErrorBreadcrumb('push', 'Failed to remove push token');
    }
}

/**
 * Handle notification received while app is in foreground
 * Show a toast or in-app banner
 */
function handleForegroundNotification(notification: PushNotificationSchema): void {
    // Get user's preferred language
    const language = localStorage.getItem('dashboard_language') || 'ar';
    
    // Extract bilingual content from notification data
    const data = notification.data as Record<string, string> | undefined;
    const title = language === 'ar' ? (data?.titleAr || notification.title) : (data?.titleEn || notification.title);
    const body = language === 'ar' ? (data?.bodyAr || notification.body) : (data?.bodyEn || notification.body);

    toast(title, { description: body, duration: 5000 });
}

/**
 * Handle notification tap - navigate to appropriate screen
 */
function handleNotificationTap(action: ActionPerformed): void {
    const data = action.notification.data as Record<string, string> | undefined;
    const type = data?.type;

    // 1. Use deepLink from backend data if available
    let customData: Record<string, string> | undefined;
    try {
        if (data?.customData) customData = JSON.parse(data.customData);
    } catch { /* ignore parse errors */ }

    if (customData?.deepLink) {
        if (typeof window !== 'undefined') window.location.href = customData.deepLink;
        return;
    }

    // 2. Fallback: route based on notification type
    const isMessage = data?.dataType === 'message';
    let route = '/dashboard';
    switch (type) {
        case 'stale_comment':
        case 'new_comment':
        case 'flagged_reply':
        case 'skipped_reply':
            route = isMessage ? '/messages?filter=flagged' : '/comments?filter=flagged';
            break;
        case 'payment_failed':
        case 'subscription_expiring':
        case 'trial_ending':
            route = '/pricing';
            break;
        case 'page_disconnected':
        case 'kb_gap':
            route = '/pages';
            break;
        default:
            route = '/dashboard';
    }

    if (typeof window !== 'undefined') {
        window.location.href = route;
    }
}

/**
 * Get unread notification count from backend.
 * Uses the authenticated api instance for consistent auth handling and retry logic.
 */
export async function getUnreadCount(): Promise<number> {
    try {
        const response = await api.get('/notifications/unread-count');
        return response.data.count || 0;
    } catch {
        addErrorBreadcrumb('notifications', 'Failed to get unread count');
        return 0;
    }
}

/**
 * Get notifications from backend.
 * Passes the user's language so the API returns only the relevant title/body.
 */
export async function getNotifications(
    limit: number = 20,
    offset: number = 0
): Promise<{
    notifications: Array<{
        id: string;
        type: string;
        title: string;
        body: string;
        data: unknown;
        read: boolean;
        createdAt: string;
    }>;
    unreadCount: number;
}> {
    try {
        const lang = localStorage.getItem('dashboard_language') || 'ar';
        const response = await api.get('/notifications', { params: { limit, offset, lang } });
        return response.data;
    } catch {
        addErrorBreadcrumb('notifications', 'Failed to get notifications');
        return { notifications: [], unreadCount: 0 };
    }
}

/**
 * Mark a notification as read
 */
export async function markNotificationAsRead(notificationId: string): Promise<void> {
    try {
        await api.patch(`/notifications/${notificationId}/read`);
    } catch {
        addErrorBreadcrumb('notifications', 'Failed to mark as read');
    }
}

/**
 * Mark all notifications as read
 */
export async function markAllNotificationsAsRead(): Promise<void> {
    try {
        await api.post('/notifications/mark-all-read');
    } catch {
        addErrorBreadcrumb('notifications', 'Failed to mark all as read');
    }
}
