import { Capacitor } from '@capacitor/core';
import { PushNotifications, Token, ActionPerformed, PushNotificationSchema } from '@capacitor/push-notifications';
import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://jawab24.com/api';

/**
 * Initialize push notifications for native platforms
 * Should be called after user login
 */
export async function initPushNotifications(token: string): Promise<void> {
    // Only run on native platforms
    if (!Capacitor.isNativePlatform()) {
        return;
    }

    try {
        // Request permission
        const permResult = await PushNotifications.requestPermissions();
        
        if (permResult.receive !== 'granted') {
            console.warn('[Push] Permission not granted');
            return;
        }

        // Register for push notifications
        await PushNotifications.register();

        // Listen for registration success
        PushNotifications.addListener('registration', async (tokenData: Token) => {
            await registerTokenWithBackend(token, tokenData.value);
        });

        // Listen for registration errors
        PushNotifications.addListener('registrationError', (error) => {
            console.error('[Push] Registration error:', error);
        });

        // Listen for push notifications received while app is in foreground
        PushNotifications.addListener('pushNotificationReceived', (notification: PushNotificationSchema) => {
            handleForegroundNotification(notification);
        });

        // Listen for push notification taps (app opened from notification)
        PushNotifications.addListener('pushNotificationActionPerformed', (action: ActionPerformed) => {
            handleNotificationTap(action);
        });

    } catch (error) {
        console.error('[Push] Init error:', error);
    }
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

    // For now, we'll let the notification show in the status bar
    // In the future, could show a custom in-app banner
    console.log('[Push] Foreground notification:', { title, body });
}

/**
 * Handle notification tap - navigate to appropriate screen
 */
function handleNotificationTap(action: ActionPerformed): void {
    const data = action.notification.data as Record<string, string> | undefined;
    const type = data?.type;

    // Navigate based on notification type
    let route = '/dashboard';
    
    switch (type) {
        case 'payment_failed':
        case 'subscription_expiring':
        case 'trial_ending':
            route = '/settings'; // Billing section
            break;
        case 'page_disconnected':
            route = '/pages';
            break;
        default:
            route = '/dashboard';
    }

    // Navigate using router (this will be picked up by deep link handler in _app.tsx)
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
