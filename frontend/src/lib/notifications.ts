 
import { Capacitor } from '@capacitor/core';
import { PushNotifications, Token, ActionPerformed, PushNotificationSchema } from '@capacitor/push-notifications';
import axios from 'axios';
import { toast } from 'sonner';
import Router from 'next/router';
import { api } from './api';
import { captureError, addErrorBreadcrumb } from '@/lib/sentryHelpers';
import { resolveNotificationRoute } from '@/components/ui/notificationUtils';
import { useUIStore } from './store';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://jawab24.com/api';

const PERM_DISMISSED_KEY = 'push_prompt_dismissed_at';
const PERM_GRANTED_KEY = 'push_permission_granted';
const PERM_DENIED_KEY = 'push_permission_denied';
const PERM_DENIED_BANNER_DISMISSED_KEY = 'push_denied_banner_dismissed_at';
const PUSH_REFRESH_LAST_AT_KEY = 'push_refresh_last_at';
const FCM_TOKEN_KEY = 'fcm_token';
const DISMISS_COOLDOWN_DAYS = 7;
const DENIED_BANNER_COOLDOWN_DAYS = 14;
const PUSH_REFRESH_THROTTLE_MS = 60 * 60 * 1000; // 1 hour

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

async function prefRemove(key: string): Promise<void> {
    if (Capacitor.isNativePlatform()) {
        const { Preferences } = await import('@capacitor/preferences');
        await Preferences.remove({ key });
    } else {
        localStorage.removeItem(key);
    }
}

/**
 * One-time migration: move notification prefs from localStorage (WebView) to
 * native Preferences so existing users don't get re-prompted after this update.
 * Safe to call multiple times — skips if already migrated or nothing to migrate.
 */
async function migrateFromLocalStorage(): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;

    // Already migrated?
    if (await prefGet(PERM_GRANTED_KEY)) return;

    const lsGranted = localStorage.getItem(PERM_GRANTED_KEY);
    if (lsGranted) {
        await prefSet(PERM_GRANTED_KEY, lsGranted);
        localStorage.removeItem(PERM_GRANTED_KEY);
    }

    const lsDismissed = localStorage.getItem(PERM_DISMISSED_KEY);
    if (lsDismissed) {
        await prefSet(PERM_DISMISSED_KEY, lsDismissed);
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

    // User explicitly denied — pre-prompt is the wrong UI for this state because
    // on Android 13+ the OS permission dialog fires only once. Re-asking via
    // pre-prompt sends the user nowhere; the denied-banner is the only path that
    // tells them to enable in system settings. (The two helpers are kept
    // mutually exclusive by this check.)
    if (await prefGet(PERM_DENIED_KEY) === 'true') return false;

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
 * Whether to show the recovery banner reminding the user that they
 * previously denied notifications. Returns true only when:
 *  - native platform
 *  - permission was explicitly denied (PERM_DENIED_KEY === 'true')
 *  - permission has not since been granted
 *  - the user hasn't dismissed this banner in the last DENIED_BANNER_COOLDOWN_DAYS
 */
export async function shouldShowPushDeniedBanner(): Promise<boolean> {
    if (!Capacitor.isNativePlatform()) return false;
    await migrateFromLocalStorage();
    if (await prefGet(PERM_GRANTED_KEY) === 'true') return false;
    if (await prefGet(PERM_DENIED_KEY) !== 'true') return false;

    const dismissedAt = await prefGet(PERM_DENIED_BANNER_DISMISSED_KEY);
    if (dismissedAt) {
        const daysSince = (Date.now() - Number(dismissedAt)) / (1000 * 60 * 60 * 24);
        if (daysSince < DENIED_BANNER_COOLDOWN_DAYS) return false;
    }
    return true;
}

/**
 * Record that the user dismissed the denied-permission recovery banner.
 * Reappears after DENIED_BANNER_COOLDOWN_DAYS.
 */
export async function dismissPushDeniedBanner(): Promise<void> {
    await prefSet(PERM_DENIED_BANNER_DISMISSED_KEY, String(Date.now()));
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
            // Mark explicit denial so the recovery banner can prompt the user
            // to re-enable from system settings (the system dialog only fires
            // once on Android 13+ — without this flag the user is silently lost).
            await prefSet(PERM_DENIED_KEY, 'true');
            return false;
        }

        // Store granted flag so we never show pre-prompt again
        // and can silently re-register on subsequent launches.
        // Set this BEFORE registerPushListeners — if listener setup fails
        // we still don't want to re-prompt (permission was granted).
        await prefSet(PERM_GRANTED_KEY, 'true');
        // Clear any prior denial flag (covers users who denied, then re-enabled
        // in system settings, then triggered the prompt again from another path).
        await prefRemove(PERM_DENIED_KEY);

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
 * Re-trigger FCM token registration so the backend receives a fresh `last_used_at`
 * (and the live token if it has rotated). Calling `PushNotifications.register()`
 * again is idempotent — the plugin re-fires the `registration` event with the
 * current token, which our existing listener POSTs to the backend.
 *
 * Self-healing: dead tokens in the DB get replaced with the live one on the
 * next app foreground, so a single transient FCM error or a server-side delete
 * doesn't permanently disconnect the device from push.
 */
export async function refreshPushRegistration(): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;
    if (await prefGet(PERM_GRANTED_KEY) !== 'true') return;
    if (!pushListenersRegistered) return; // initPushNotifications hasn't run yet — nothing to refresh

    // Throttle: heavy users foreground the app dozens of times a day; without
    // this every resume would POST /notifications/register-token. Preferences
    // (not in-memory) so the throttle survives WebView restarts and cold starts.
    const lastAt = await prefGet(PUSH_REFRESH_LAST_AT_KEY);
    if (lastAt && Date.now() - Number(lastAt) < PUSH_REFRESH_THROTTLE_MS) return;

    try {
        await PushNotifications.register();
        await prefSet(PUSH_REFRESH_LAST_AT_KEY, String(Date.now()));
    } catch (error) {
        captureError(error, 'Push registration refresh failed', { tags: { context: 'push-refresh' } });
    }
}

/**
 * Register the notification tap handler early — before auth, before splash hides.
 * Capacitor queues tap events from cold starts and delivers them when the listener
 * is added, so registering this ASAP ensures the app navigates to the correct
 * screen before the user sees any intermediate page.
 *
 * Safe to call multiple times — guards against double-registration.
 */
let tapListenerRegistered = false;
export async function registerNotificationTapListener(): Promise<void> {
    if (!Capacitor.isNativePlatform() || tapListenerRegistered) return;
    tapListenerRegistered = true;

    await PushNotifications.addListener('pushNotificationActionPerformed', (action: ActionPerformed) => {
        handleNotificationTap(action);
    });
}

/**
 * Internal: register for push and set up all listeners (except tap — handled early).
 *
 * Listeners MUST be attached before calling register() — the Capacitor plugin
 * fires the `registration` event as soon as FCM/APNs returns a token, and there
 * is no replay. Attaching late means the token is lost and the backend never
 * receives it, so push notifications silently stop working.
 */
let pushListenersRegistered = false;
async function registerPushListeners(authToken: string): Promise<void> {
    if (pushListenersRegistered) return;
    pushListenersRegistered = true;

    await PushNotifications.addListener('registration', async (tokenData: Token) => {
        await registerTokenWithBackend(authToken, tokenData.value);
    });

    await PushNotifications.addListener('registrationError', (error) => {
        captureError(error, 'Push registration error', { tags: { context: 'push-registration' } });
    });

    await PushNotifications.addListener('pushNotificationReceived', (notification: PushNotificationSchema) => {
        handleForegroundNotification(notification);
    });

    await PushNotifications.register();
}

/**
 * Register FCM token with backend
 */
async function registerTokenWithBackend(authToken: string, fcmToken: string): Promise<void> {
    try {
        const platform = Capacitor.getPlatform() as 'android' | 'ios' | 'web';

        // If FCM rotated the token (same install, new value), revoke the old one
        // first so the server doesn't keep fanning pushes out to both. App
        // reinstall wipes this storage, so the server's stale-token cleanup
        // handles that case instead.
        const previousToken = (await prefGet(FCM_TOKEN_KEY)) ?? localStorage.getItem('fcm_token');
        if (previousToken && previousToken !== fcmToken) {
            try {
                await axios.post(
                    `${API_URL}/notifications/remove-token`,
                    { token: previousToken },
                    { headers: { Authorization: `Bearer ${authToken}` } }
                );
            } catch (error) {
                addErrorBreadcrumb('push', 'Failed to remove previous FCM token before registering new one');
                captureError(error, 'Failed to remove previous FCM token', { tags: { context: 'push' } });
            }
        }

        await axios.post(
            `${API_URL}/notifications/register-token`,
            { token: fcmToken, platform },
            { headers: { Authorization: `Bearer ${authToken}` } }
        );

        await prefSet(FCM_TOKEN_KEY, fcmToken);
        // Drop the legacy localStorage entry so we don't read it again next time.
        if (typeof window !== 'undefined') {
            localStorage.removeItem('fcm_token');
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
        const fcmToken = (await prefGet(FCM_TOKEN_KEY)) ?? localStorage.getItem('fcm_token');
        if (fcmToken) {
            await axios.post(
                `${API_URL}/notifications/remove-token`,
                { token: fcmToken },
                { headers: { Authorization: `Bearer ${authToken}` } }
            );
            await prefRemove(FCM_TOKEN_KEY);
            if (typeof window !== 'undefined') {
                localStorage.removeItem('fcm_token');
            }
        }
    } catch {
        addErrorBreadcrumb('push', 'Failed to remove push token');
    }
}

/**
 * Get the current app locale, outside React components (no hooks needed).
 *
 * Resolution order mirrors `effectiveLocale` in `_app.tsx`: the URL path first
 * (web has i18n routing, so `/en/...` is authoritative), then the persisted UI
 * store.
 *
 * The store step is NOT a cosmetic fallback — it is the ONLY signal in the
 * native app. Mobile is a static export with `i18n: undefined`
 * (`next.config.js`), and `useLanguage().setLanguage` on native updates the
 * store + `<html lang>` without navigating, so a locale prefix never appears in
 * the path. Reading the URL alone pinned every in-app notification and push
 * toast to Arabic no matter what language the merchant had selected.
 */
function getAppLocale(): 'ar' | 'en' {
    if (typeof window !== 'undefined') {
        // Primary: read from URL path (/en/... or /ar/...)
        const pathLocale = window.location.pathname.split('/')[1];
        if (pathLocale === 'en' || pathLocale === 'ar') return pathLocale;
    }
    return useUIStore.getState().language === 'en' ? 'en' : 'ar';
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
 * Navigate via Next.js router when available (keeps in-memory auth/state),
 * falling back to a full reload only on cold starts before the router mounts.
 * A hard reload triggers re-hydration, which briefly routes through the
 * landing/auth redirect path and can drop query params.
 */
function navigateTo(url: string): void {
    if (typeof window === 'undefined') return;
    // Router.router is null until _app.tsx mounts; use it when available.
    if (Router.router) {
        Router.push(url).catch(() => {
            window.location.href = url;
        });
        return;
    }
    window.location.href = url;
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

    navigateTo(resolveNotificationRoute(type ?? '', customData) ?? '/dashboard');
}

export interface UnreadCountResult {
    count: number;
    /** Seconds to wait before retrying, set when rate-limited (HTTP 429). */
    retryAfter?: number;
}

/**
 * Get unread notification count from backend.
 * Returns retryAfter when rate-limited so callers can back off intelligently.
 */
export async function getUnreadCount(): Promise<UnreadCountResult> {
    try {
        const response = await api.get('/notifications/unread-count');
        return { count: response.data.count || 0 };
    } catch (error) {
        const axiosErr = error as { response?: { status?: number; headers?: Record<string, string>; data?: { retryAfter?: string } } };
        if (axiosErr.response?.status === 429) {
            const raw = axiosErr.response.headers?.['retry-after'] ?? axiosErr.response.data?.retryAfter;
            const retryAfter = raw ? parseInt(String(raw), 10) : 60;
            // Expected, self-healing backpressure: the poller backs off by
            // retryAfter and resumes on the next tick. Record a breadcrumb only —
            // reporting every handled 429 flooded Sentry (532 events,
            // JAWAB24-FRONTEND-1R). A genuine outage still escalates via the
            // poller's circuit breaker (3 consecutive failures → level=error).
            addErrorBreadcrumb('notifications', 'Notification poll rate-limited (backing off)', { retryAfter });
            return { count: 0, retryAfter };
        }
        addErrorBreadcrumb('notifications', 'Failed to get unread count');
        return { count: 0 };
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
