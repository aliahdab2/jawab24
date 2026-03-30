 
import { Capacitor } from '@capacitor/core';
import { PushNotifications, Token, ActionPerformed, PushNotificationSchema } from '@capacitor/push-notifications';
import axios from 'axios';
import { toast } from 'sonner';
import { api } from './api';
import { captureError, addErrorBreadcrumb } from '@/lib/sentryHelpers';
import { ACTIONABLE_NOTIFICATION_TYPES } from '@/components/notifications/NotificationFilterPills';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://jawab24.com/api';

const PERM_DISMISSED_KEY = 'push_prompt_dismissed_at';
const PERM_GRANTED_KEY = 'push_permission_granted';
const DISMISS_COOLDOWN_DAYS = 7;

/**
 * Native-safe key/value helpers.
 * Uses @capacitor/preferences (SharedPreferences on Android, UserDefaults on
 * iOS) which survives WebView cache clears — unlike localStorage which Samsung
 * and other OEMs can wipe aggressively.
 * Falls back to localStorage on web.
 */
async function prefGet(key: string): Promise<string | null> {
    if (Capacitor.isNativePlatform()) {
        const { Preferences } = await import('@capacitor/preferences');
        const { value } = await Preferences.get({ key });
        return value;
    }
    return localStorage.getItem(key);
}

async function prefSet(key: string, value: string): Promise<void> {
    if (Capacitor.isNativePlatform()) {
        const { Preferences } = await import('@capacitor/preferences');
        await Preferences.set({ key, value });
    } else {
        localStorage.setItem(key, value);
    }
}

/**
 * One-time migration: move notification prefs from localStorage (WebView) to
 * native Preferences so existing users don't get re-prompted after this update.
 * Safe to call multiple times — skips if already migrated or nothing to migrate.
 */
async function migrateFromLocalStorage(): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;
    const { Preferences } = await import('@capacitor/preferences');

    // Already migrated?
    const { value: granted } = await Preferences.get({ key: PERM_GRANTED_KEY });
    if (granted) return;

    // Migrate granted flag
    const lsGranted = localStorage.getItem(PERM_GRANTED_KEY);
    if (lsGranted) {
        await Preferences.set({ key: PERM_GRANTED_KEY, value: lsGranted });
        localStorage.removeItem(PERM_GRANTED_KEY);
    }

    // Migrate dismissed timestamp
    const lsDismissed = localStorage.getItem(PERM_DISMISSED_KEY);
    if (lsDismissed) {
        await Preferences.set({ key: PERM_DISMISSED_KEY, value: lsDismissed });
        localStorage.removeItem(PERM_DISMISSED_KEY);
    }
}

/**
 * Check if we should show the pre-prompt to the user.
 * Uses native Preferences — does NOT call any Capacitor Push API to avoid
 * triggering the Android 13+ system permission dialog prematurely.
 */
export async function shouldShowNotificationPrePrompt(): Promise<boolean> {
    if (!Capacitor.isNativePlatform()) return false;

    // Migrate any existing localStorage values to native Preferences
    await migrateFromLocalStorage();

    // Already granted or user completed the flow before
    if (await prefGet(PERM_GRANTED_KEY) === 'true') return false;

    // User dismissed the pre-prompt recently
    const dismissedAt = await prefGet(PERM_DISMISSED_KEY);
    if (dismissedAt) {
        const daysSince = (Date.now() - Number(dismissedAt)) / (1000 * 60 * 60 * 24);
        if (daysSince < DISMISS_COOLDOWN_DAYS) return false;
    }

    return true;
}

/**
 * Record that the user tapped "Not now" on the pre-prompt.
 */
export async function dismissNotificationPrePrompt(): Promise<void> {
    await prefSet(PERM_DISMISSED_KEY, String(Date.now()));
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
        if (permResult.receive !== 'granted') {
            // User denied the system dialog — record as dismissed so the
            // pre-prompt doesn't reappear immediately (respects cooldown).
            await prefSet(PERM_DISMISSED_KEY, String(Date.now()));
            return false;
        }

        // Store granted flag so we never show pre-prompt again
        // and can silently re-register on subsequent launches.
        // Set this BEFORE registerPushListeners — if listener setup fails
        // we still don't want to re-prompt (permission was granted).
        await prefSet(PERM_GRANTED_KEY, 'true');

        await registerPushListeners(authToken);
        return true;
    } catch (error) {
        // Plugin error (e.g. Samsung WebView quirk) — still mark as
        // user-interacted so the prompt doesn't keep reappearing.
        await prefSet(PERM_DISMISSED_KEY, String(Date.now()));
        captureError(error, 'Push permission request error', { tags: { context: 'push' } });
        return false;
    }
}

/**
 * Initialize push notifications for native platforms.
 * Only sets up listeners if user previously granted permission (checked via
 * native Preferences). Does NOT call checkPermissions() to avoid triggering
 * Android 13+ system dialog.
 */
export async function initPushNotifications(token: string): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;

    // Only proceed if we know permission was previously granted
    if (await prefGet(PERM_GRANTED_KEY) !== 'true') return;

    try {
        await registerPushListeners(token);
    } catch (error) {
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
 * Get the current app locale from the URL path or Zustand store fallback.
 * Works outside React components (no hooks needed).
 */
function getAppLocale(): 'ar' | 'en' {
    if (typeof window !== 'undefined') {
        // Primary: read from URL path (/en/... or /ar/...)
        const pathLocale = window.location.pathname.split('/')[1];
        if (pathLocale === 'en' || pathLocale === 'ar') return pathLocale;
    }
    return 'ar';
}

/**
 * Handle notification received while app is in foreground
 * Show a toast or in-app banner
 */
function handleForegroundNotification(notification: PushNotificationSchema): void {
    const language = getAppLocale();

    // Parse JSONB locale maps from push data, with fallback to OS-level notification
    const data = notification.data as Record<string, string> | undefined;
    let titles: Record<string, string> = {};
    let bodies: Record<string, string> = {};
    try { if (data?.titles) titles = JSON.parse(data.titles); } catch { /* malformed — use fallback */ }
    try { if (data?.bodies) bodies = JSON.parse(data.bodies); } catch { /* malformed — use fallback */ }

    const title = titles[language] || titles['en'] || notification.title;
    const body = bodies[language] || bodies['en'] || notification.body;

    toast(title, { description: body, duration: 5000 });
}

/**
 * Handle notification tap - navigate to appropriate screen
 */
function handleNotificationTap(action: ActionPerformed): void {
    const data = action.notification.data as Record<string, string | object> | undefined;
    const type = data?.type as string | undefined;

    // Parse customData — on Android background, FCM may deliver it as
    // an already-parsed object OR as a JSON string depending on OS version.
    let customData: Record<string, string> | undefined;
    try {
        const raw = data?.customData;
        if (raw && typeof raw === 'string') {
            customData = JSON.parse(raw);
        } else if (raw && typeof raw === 'object') {
            customData = raw as Record<string, string>;
        }
    } catch {
        addErrorBreadcrumb('notification', 'customData parse failed', { raw: String(data?.customData) });
    }

    addErrorBreadcrumb('notification', 'tap', { type, hasCustomData: !!customData, keys: customData ? Object.keys(customData).join(',') : '' });

    // 1a. Prefer item-specific deep links for comment/message notifications
    const isCommentType = ACTIONABLE_NOTIFICATION_TYPES.includes(type as typeof ACTIONABLE_NOTIFICATION_TYPES[number]);
    if (isCommentType && customData) {
        const isMessage = customData.type === 'message';
        if (isMessage && customData.messageId) {
            if (typeof window !== 'undefined') window.location.href = `/messages?messageId=${encodeURIComponent(customData.messageId)}`;
            return;
        }
        if (!isMessage && customData.commentId) {
            if (typeof window !== 'undefined') window.location.href = `/comments?commentId=${encodeURIComponent(customData.commentId)}`;
            return;
        }
    }

    // 1b. For non-comment types, use stored deepLink
    if (customData?.deepLink && !isCommentType) {
        if (typeof window !== 'undefined') window.location.href = customData.deepLink;
        return;
    }

    // 2. Fallback: route based on notification type
    // For types shared by comments and messages (flagged_reply, skipped_reply),
    // use customData.type to pick the right page, default to comments.
    const itemType = customData?.type;
    let route = '/dashboard';
    switch (type) {
        case 'stale_comment':
        case 'new_comment':
            route = '/comments?filter=needs_action';
            break;
        case 'stale_message':
            route = '/messages?filter=needs_action';
            break;
        case 'flagged_reply':
        case 'skipped_reply':
            route = itemType === 'message' ? '/messages?filter=flagged' : '/comments?filter=flagged';
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
        const lang = getAppLocale();
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
