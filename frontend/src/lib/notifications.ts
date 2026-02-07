 
import { Capacitor } from '@capacitor/core';
import { PushNotifications, Token, ActionPerformed, PushNotificationSchema } from '@capacitor/push-notifications';
import axios from 'axios';
import { toast } from 'sonner';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://jawab24.com/api';

const PERM_DISMISSED_KEY = 'push_prompt_dismissed_at';
const DISMISS_COOLDOWN_DAYS = 7;

/**
 * Check if we should show the pre-prompt to the user.
 * Returns true if: native platform, permission not yet decided, and cooldown expired.
 */
export async function shouldShowNotificationPrePrompt(): Promise<boolean> {
    if (!Capacitor.isNativePlatform()) return false;

    try {
        const permStatus = await PushNotifications.checkPermissions();
        if (permStatus.receive === 'granted' || permStatus.receive === 'denied') return false;

        const dismissedAt = localStorage.getItem(PERM_DISMISSED_KEY);
        if (dismissedAt) {
            const daysSince = (Date.now() - Number(dismissedAt)) / (1000 * 60 * 60 * 24);
            if (daysSince < DISMISS_COOLDOWN_DAYS) return false;
        }

        return true;
    } catch {
        return false;
    }
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
 */
export async function requestAndRegisterPush(authToken: string): Promise<boolean> {
    if (!Capacitor.isNativePlatform()) return false;

    try {
        const permResult = await PushNotifications.requestPermissions();
        if (permResult.receive !== 'granted') return false;

        await registerPushListeners(authToken);
        return true;
    } catch (error) {
        console.error('[Push] Permission request error:', error);
        return false;
    }
}

/**
 * Initialize push notifications for native platforms.
 * Only sets up listeners if permission was already granted (e.g. on subsequent app launches).
 * Does NOT request permission — use requestAndRegisterPush() for that.
 */
export async function initPushNotifications(token: string): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;

    try {
        const permStatus = await PushNotifications.checkPermissions();
        if (permStatus.receive !== 'granted') return;

        await registerPushListeners(token);
    } catch (error) {
        console.error('[Push] Init error:', error);
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
        console.error('[Push] Registration error:', error);
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
        console.error('[Push] Failed to register token with backend:', error);
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
    } catch (error) {
        console.error('[Push] Failed to remove token:', error);
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
    let route = '/dashboard';
    switch (type) {
        case 'stale_comment':
        case 'new_comment':
        case 'flagged_reply':
            route = '/comments';
            break;
        case 'payment_failed':
        case 'subscription_expiring':
        case 'trial_ending':
            route = '/pricing';
            break;
        case 'page_disconnected':
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
 * Get unread notification count from backend
 */
export async function getUnreadCount(authToken: string): Promise<number> {
    try {
        const response = await axios.get(
            `${API_URL}/notifications/unread-count`,
            { headers: { Authorization: `Bearer ${authToken}` } }
        );
        return response.data.count || 0;
    } catch (error) {
        console.error('[Notifications] Failed to get unread count:', error);
        return 0;
    }
}

/**
 * Get notifications from backend
 */
export async function getNotifications(
    authToken: string,
    limit: number = 20,
    offset: number = 0
): Promise<{
    notifications: Array<{
        id: string;
        type: string;
        titleEn: string;
        titleAr: string;
        bodyEn: string;
        bodyAr: string;
        data: unknown;
        read: boolean;
        createdAt: string;
    }>;
    unreadCount: number;
}> {
    try {
        const response = await axios.get(
            `${API_URL}/notifications`,
            { 
                headers: { Authorization: `Bearer ${authToken}` },
                params: { limit, offset }
            }
        );
        return response.data;
    } catch (error) {
        console.error('[Notifications] Failed to get notifications:', error);
        return { notifications: [], unreadCount: 0 };
    }
}

/**
 * Mark a notification as read
 */
export async function markNotificationAsRead(authToken: string, notificationId: string): Promise<void> {
    try {
        await axios.patch(
            `${API_URL}/notifications/${notificationId}/read`,
            {},
            { headers: { Authorization: `Bearer ${authToken}` } }
        );
    } catch (error) {
        console.error('[Notifications] Failed to mark as read:', error);
    }
}

/**
 * Mark all notifications as read
 */
export async function markAllNotificationsAsRead(authToken: string): Promise<void> {
    try {
        await axios.post(
            `${API_URL}/notifications/mark-all-read`,
            {},
            { headers: { Authorization: `Bearer ${authToken}` } }
        );
    } catch (error) {
        console.error('[Notifications] Failed to mark all as read:', error);
    }
}
