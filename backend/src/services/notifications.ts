import { db } from '../db';
import { deviceTokens, notifications, notificationSendLog, settings, workspaceMembers } from '../db/schema';
import { eq, and, desc, count, inArray, lt, ne } from 'drizzle-orm';
import { captureError } from '../utils/sentryHelpers';
import { flagReasonEn, flagReasonAr } from '@jawab24/shared';
import { redis } from '../lib/redis';
import { createHash } from 'crypto';

/**
 * Android notification channel IDs. Must match the channels registered in
 * Jawab24Application.onCreate() (see android/.../Jawab24Application.java).
 * Without this, Android 8+ silently drops notifications when no channel matches.
 *
 * Default channel: IMPORTANCE_DEFAULT (silent tray entry).
 * Urgent channel:  IMPORTANCE_HIGH (heads-up + sound) — used when payload.data.urgent === true.
 */
const ANDROID_CHANNEL_ID = 'jawab24_default';
const ANDROID_URGENT_CHANNEL_ID = 'jawab24_urgent';

/**
 * After this many days of not being re-registered, a device token is assumed
 * abandoned (app uninstalled / device wiped) and is pruned opportunistically
 * on the next register from the same user+platform. Without this, reinstalls
 * leave stale rows that FCM still accepts for hours, causing the device to
 * receive every push twice (once per token) until permanent_failure prunes them.
 *
 * Live devices touch `last_used_at` on every app open via `refreshPushRegistration`
 * (throttled to 1h on the client), so 30 days is conservative.
 */
const STALE_TOKEN_DAYS = 30;

/**
 * FCM error codes that mean the token is permanently dead.
 * Anything else (server errors, quota, network) is transient — keep the token.
 * Source: https://firebase.google.com/docs/reference/admin/error-handling#fcm-server-errors
 */
export const PERMANENT_FCM_TOKEN_ERRORS = new Set([
    'messaging/registration-token-not-registered',
    'messaging/invalid-registration-token',
    'messaging/invalid-argument',
]);

/**
 * Classify a single FCM send response so the send path can decide whether
 * to delete the token, log a transient failure, or do nothing.
 * Pure function — exported for unit testing.
 */
export function classifyFcmResult(success: boolean, errorCode: string | undefined): 'success' | 'permanent_failure' | 'transient_failure' {
    if (success) return 'success';
    if (errorCode && PERMANENT_FCM_TOKEN_ERRORS.has(errorCode)) return 'permanent_failure';
    return 'transient_failure';
}

export function hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
}

// Notification types
export type NotificationType =
    | 'payment_failed'
    | 'subscription_expiring'
    | 'page_disconnected'
    | 'subscription_renewed'
    | 'trial_ending'
    | 'flagged_reply'
    | 'skipped_reply'
    | 'new_comment'
    | 'stale_comment'
    | 'stale_message'
    | 'kb_gap'
    | 'provider_failover'
    | 'ai_usage_warning_80'
    | 'ai_usage_limit_reached'
    | 'auto_reply_paused_billing'
    | 'refund_processed';

export interface NotificationPayload {
    type: NotificationType;
    titles: Record<string, string>;  // { en: '...', ar: '...', fr: '...' }
    bodies: Record<string, string>;  // { en: '...', ar: '...', fr: '...' }
    data?: Record<string, unknown>;
}

/** Default fallback language when the requested locale has no translation */
const FALLBACK_LANG = 'en';

/**
 * Push notification cooldown (seconds) per type, per user.
 * Prevents phone spam when hundreds of messages are processed at once
 * (e.g. on first page connection). Notifications are still stored in DB;
 * only the FCM push is suppressed during the cooldown window.
 * Types not listed here are always pushed (payment, subscription, etc.).
 */
const PUSH_COOLDOWN_SECONDS: Partial<Record<NotificationType, number>> = {
    flagged_reply:    300,  // 5 min
    skipped_reply:   300,  // 5 min
    new_comment:     300,  // 5 min
    stale_comment:   300,  // 5 min
    stale_message:   300,  // 5 min
    kb_gap:         3600,  // 1 hour
    provider_failover: 600, // 10 min
};

// Notification templates — keyed by locale for easy multi-language expansion
export const NOTIFICATION_TEMPLATES: Record<NotificationType, Pick<NotificationPayload, 'titles' | 'bodies'>> = {
    payment_failed: {
        titles: { en: 'Payment Failed', ar: 'فشل الدفع' },
        bodies: {
            en: 'We couldn\'t process your payment. Please update your payment method to continue using Jawab24.',
            ar: 'لم نتمكن من معالجة الدفع. يرجى تحديث طريقة الدفع لمواصلة استخدام Jawab24.',
        },
    },
    subscription_expiring: {
        titles: { en: 'Subscription Expiring Soon', ar: 'اشتراكك ينتهي قريباً' },
        bodies: {
            en: 'Your subscription expires in {days} days. Renew now to avoid service interruption.',
            ar: 'ينتهي اشتراكك خلال {days} أيام. جدد الآن لتجنب انقطاع الخدمة.',
        },
    },
    page_disconnected: {
        titles: { en: 'Page Disconnected', ar: 'تم فصل الصفحة' },
        bodies: {
            en: 'Your page \'{pageName}\' has been disconnected. Please reconnect to resume auto-replies.',
            ar: 'تم فصل صفحتك \'{pageName}\'. يرجى إعادة الاتصال لاستئناف الرد التلقائي.',
        },
    },
    subscription_renewed: {
        titles: { en: 'Subscription Renewed', ar: 'تم تجديد الاشتراك' },
        bodies: {
            en: 'Your subscription has been successfully renewed. Thank you for using Jawab24!',
            ar: 'تم تجديد اشتراكك بنجاح. شكراً لاستخدامك Jawab24!',
        },
    },
    trial_ending: {
        titles: { en: 'Trial Ending Soon', ar: 'تنتهي الفترة التجريبية قريباً' },
        bodies: {
            en: 'Your free trial ends in {days} days. Subscribe now to keep using Jawab24.',
            ar: 'تنتهي فترتك التجريبية المجانية خلال {days} أيام. اشترك الآن للاستمرار في استخدام Jawab24.',
        },
    },
    flagged_reply: {
        titles: { en: 'Reply Needs Your Attention', ar: 'رد يحتاج انتباهك' },
        bodies: {
            en: 'A Smart Reply to "{senderName}" was flagged: {reason}. Please review it.',
            ar: 'تم وضع علامة على رد ذكي لـ "{senderName}": {reason}. يرجى مراجعته.',
        },
    },
    skipped_reply: {
        titles: { en: 'Auto-Reply Skipped', ar: 'تم تخطي الرد التلقائي' },
        bodies: {
            en: 'A reply to "{senderName}" was skipped: {reason}. Please review and reply manually.',
            ar: 'تم تخطي الرد التلقائي لـ "{senderName}": {reason}. يرجى مراجعته والرد يدوياً.',
        },
    },
    new_comment: {
        titles: { en: 'New Comment', ar: 'تعليق جديد' },
        bodies: {
            en: 'New comment from {senderName} is waiting for your reply.',
            ar: 'تعليق جديد من {senderName} بانتظار ردك.',
        },
    },
    stale_comment: {
        titles: { en: '{senderName} — {pageName}', ar: '{senderName} — {pageName}' },
        bodies: { en: '{preview}', ar: '{preview}' },
    },
    stale_message: {
        titles: { en: '{senderName} — {pageName}', ar: '{senderName} — {pageName}' },
        bodies: { en: '{preview}', ar: '{preview}' },
    },
    kb_gap: {
        titles: { en: 'Knowledge Base Gap Detected', ar: 'فجوة في قاعدة المعرفة' },
        bodies: {
            en: 'Customers on "{pageName}" keep asking about "{topic}" but your knowledge base doesn\'t cover it.',
            ar: 'عملاء "{pageName}" يسألون عن "{topic}" لكن قاعدة المعرفة لا تغطي هذا الموضوع.',
        },
    },
    provider_failover: {
        titles: { en: 'AI Provider Failover Active', ar: 'تم تفعيل مزود الذكاء الاصطناعي الاحتياطي' },
        bodies: {
            en: 'OpenAI is unreachable. Replies are being generated by {fallbackModel}. Check your OpenAI account status.',
            ar: 'لا يمكن الوصول إلى OpenAI. يتم إنشاء الردود بواسطة {fallbackModel}. تحقق من حالة حساب OpenAI الخاص بك.',
        },
    },
    ai_usage_warning_80: {
        titles: { en: 'You\'ve used 80% of your monthly replies', ar: 'لقد استهلكت 80% من ردودك الشهرية' },
        bodies: {
            en: 'You\'ve used {used} of {limit} Smart Replies this month. Upgrade your plan to avoid interruptions.',
            ar: 'لقد استخدمت {used} من {limit} رد ذكي هذا الشهر. قم بترقية باقتك لتجنب انقطاع الخدمة.',
        },
    },
    ai_usage_limit_reached: {
        titles: { en: 'Smart Reply limit reached', ar: 'تم الوصول للحد الأقصى من الردود الذكية' },
        bodies: {
            en: 'You\'ve hit your limit of {limit} Smart Replies this month. Post Replies and away/greeting messages keep working — but comments and DMs outside those rules now receive a generic fallback. Upgrade to resume Smart Replies.',
            ar: 'لقد وصلت إلى الحد الأقصى البالغ {limit} رد ذكي هذا الشهر. تستمر ردود البوست ورسائل الترحيب/الغياب في العمل — لكن التعليقات والرسائل خارج هذه القواعد ستتلقى رداً عاماً. قم بالترقية لاستئناف الردود الذكية.',
        },
    },
    auto_reply_paused_billing: {
        titles: { en: 'Auto-reply paused — subscription inactive', ar: 'تم إيقاف الرد التلقائي — الاشتراك غير نشط' },
        bodies: {
            en: 'Your subscription is {reason}. All auto-replies (Smart Replies, Post Replies, away messages) are paused until you renew. New comments and DMs will go unanswered.',
            ar: 'اشتراكك {reason}. تم إيقاف جميع الردود التلقائية (الردود الذكية وردود البوست ورسائل الغياب) حتى التجديد. لن يتم الرد على التعليقات والرسائل الجديدة.',
        },
    },
    refund_processed: {
        titles: { en: 'Refund Processed', ar: 'تمت معالجة المبلغ المسترد' },
        bodies: {
            en: 'A refund of {amount} {currency} has been issued to your card. It may take 5–10 business days to appear on your statement.',
            ar: 'تم إرجاع مبلغ {amount} {currency} إلى بطاقتك. قد يستغرق ظهوره في كشف الحساب من 5 إلى 10 أيام عمل.',
        },
    },
};

/** Internal-only flag fragments that carry metadata, not user-facing reasons.
 *  These are stripped before the reason string is shown to the user. */
const METADATA_FLAG_PREFIXES = ['expected_lang:', 'reply_lang:'];

// Single source of truth: packages/shared/src/i18n/{en,ar}/flagReason.json
const FLAG_REASON_EN: Record<string, string> = flagReasonEn;
const FLAG_REASON_AR: Record<string, string> = flagReasonAr;

/** Arabic fallback for 'Unknown' sender name */
const UNKNOWN_SENDER_AR = 'مجهول';

function translateFlagReason(reason: string, lang: string): string {
    const map = lang === 'ar' ? FLAG_REASON_AR : FLAG_REASON_EN;
    const separator = lang === 'ar' ? '، ' : ', ';

    // Exact match (simple flags like "angry_customer")
    if (map[reason]) return map[reason];

    // Enriched reasons like "Cancellation Request — order #5678":
    // translate the label prefix and keep the suffix (order number).
    for (const [key, val] of Object.entries(map)) {
        if (reason.startsWith(key) && reason.length > key.length && reason[key.length] === ' ') {
            return val + reason.slice(key.length);
        }
    }

    // Comma-separated flags (e.g., "language_mismatch,expected_lang:en,reply_lang:ar")
    // Strip internal metadata flags (expected_lang:*, reply_lang:*) before translating.
    const parts = reason.split(',')
        .map(f => f.trim())
        .filter(f => !METADATA_FLAG_PREFIXES.some(prefix => f.startsWith(prefix)));

    return parts.map(f => map[f] || f).join(separator);
}

/**
 * Replace template placeholders in a localized string map.
 * Arabic gets special handling for `reason` (translated) and `senderName` ('Unknown' → مجهول).
 */
function buildTemplatePayload(
    type: NotificationType,
    variables: Record<string, string>,
    data?: Record<string, unknown>,
): NotificationPayload {
    const template = NOTIFICATION_TEMPLATES[type];
    return {
        type,
        titles: replaceVariables(template.titles, variables),
        bodies: replaceVariables(template.bodies, variables),
        data,
    };
}

function replaceVariables(
    templateMap: Record<string, string>,
    variables: Record<string, string>,
): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [lang, text] of Object.entries(templateMap)) {
        let resolved = text;
        for (const [key, value] of Object.entries(variables)) {
            const placeholder = `{${key}}`;
            let replacement = value;
            if (key === 'reason') {
                replacement = translateFlagReason(value, lang);
            } else if (lang === 'ar' && key === 'senderName' && value === 'Unknown') {
                replacement = UNKNOWN_SENDER_AR;
            }
            resolved = resolved.replace(placeholder, replacement);
        }
        result[lang] = resolved;
    }
    return result;
}

class NotificationService {
    /**
     * Register a device token for push notifications
     */
    async registerDeviceToken(
        userId: string,
        token: string,
        platform: 'android' | 'ios' | 'web'
    ): Promise<void> {
        // Check if token already exists for this user
        const existing = await db
            .select()
            .from(deviceTokens)
            .where(and(
                eq(deviceTokens.userId, userId),
                eq(deviceTokens.token, token)
            ))
            .limit(1);

        if (existing.length > 0) {
            // Update last used timestamp
            await db
                .update(deviceTokens)
                .set({ lastUsedAt: new Date() })
                .where(eq(deviceTokens.id, existing[0].id));
        } else {
            try {
                await db.insert(deviceTokens).values({
                    userId,
                    token,
                    platform,
                });
            } catch (err: unknown) {
                // FK violation = user was deleted but JWT is still valid — ignore silently
                const pgErr = err as { code?: string };
                if (pgErr.code === '23503') return;
                throw err;
            }
        }

        // Opportunistic cleanup: prune sibling tokens for the same user+platform
        // that haven't been re-registered in STALE_TOKEN_DAYS. Catches reinstall
        // leftovers that FCM hasn't yet flagged as NotRegistered (Android can
        // keep accepting the old token for hours after uninstall, delivering
        // every push twice in the meantime).
        const staleCutoff = new Date(Date.now() - STALE_TOKEN_DAYS * 24 * 60 * 60 * 1000);
        await db
            .delete(deviceTokens)
            .where(and(
                eq(deviceTokens.userId, userId),
                eq(deviceTokens.platform, platform),
                ne(deviceTokens.token, token),
                lt(deviceTokens.lastUsedAt, staleCutoff),
            ));
    }

    /**
     * Remove a device token (e.g., on logout)
     */
    async removeDeviceToken(userId: string, token: string): Promise<void> {
        await db
            .delete(deviceTokens)
            .where(and(
                eq(deviceTokens.userId, userId),
                eq(deviceTokens.token, token)
            ));
    }

    /**
     * Get all device tokens (with platform) for a user.
     */
    async getUserDeviceTokens(userId: string): Promise<Array<{ token: string; platform: string }>> {
        return db
            .select({ token: deviceTokens.token, platform: deviceTokens.platform })
            .from(deviceTokens)
            .where(eq(deviceTokens.userId, userId));
    }

    /**
     * Create and send a notification to a user.
     * Stores all locale variants in JSONB; push uses user's preferred language.
     */
    async sendNotification(
        userId: string,
        payload: NotificationPayload
    ): Promise<string> {
        // 1. Store notification in database (for in-app display)
        const [notification] = await db
            .insert(notifications)
            .values({
                userId,
                type: payload.type,
                titles: payload.titles,
                bodies: payload.bodies,
                data: payload.data || {},
            })
            .returning({ id: notifications.id });

        // 2. Get user's device tokens and language preference
        const [tokens, userLanguage] = await Promise.all([
            this.getUserDeviceTokens(userId),
            this.getUserLanguage(userId),
        ]);

        // 3. Send push notification via FCM (if tokens exist and FCM is configured)
        // Rate-limit noisy notification types to prevent phone spam on bulk processing
        if (tokens.length > 0) {
            const cooldown = PUSH_COOLDOWN_SECONDS[payload.type];
            let pushAllowed = true;

            if (cooldown) {
                try {
                    const key = `notif:push:rl:${userId}:${payload.type}`;
                    const set = await redis.set(key, '1', 'EX', cooldown, 'NX');
                    pushAllowed = set === 'OK'; // null means key already existed → rate limited
                } catch {
                    // Redis unavailable — allow push rather than silently suppressing it
                    pushAllowed = true;
                }
            }

            if (pushAllowed) {
                await this.sendPushNotification(userId, notification.id, tokens, payload, userLanguage);
            }
        }

        return notification.id;
    }

    /**
     * Send notification using a template.
     * Replaces {variables} in all locale variants, then delegates to sendNotification.
     */
    async sendTemplateNotification(
        userId: string,
        type: NotificationType,
        variables: Record<string, string> = {},
        data?: Record<string, unknown>
    ): Promise<string> {
        return this.sendNotification(userId, buildTemplatePayload(type, variables, data));
    }

    /**
     * Get user's preferred language from settings
     */
    private async getUserLanguage(userId: string): Promise<string> {
        try {
            const [userSettings] = await db
                .select({ dashboardLanguage: settings.dashboardLanguage })
                .from(settings)
                .where(eq(settings.userId, userId))
                .limit(1);

            return userSettings?.dashboardLanguage || 'ar';
        } catch {
            return 'ar'; // Default to Arabic
        }
    }

    /**
     * Send push notification via FCM.
     *
     * Per-token responsibilities:
     * - Audit every send to `notification_send_log` (token stored as SHA-256 hash)
     * - Delete tokens only on permanent FCM errors (NotRegistered / InvalidArgument).
     *   Transient errors (server-unavailable, internal-error, quota) keep the token.
     * - Include Android channelId so notifications are not silently dropped on
     *   Android 8+ devices that don't fall back to a default channel.
     */
    private async sendPushNotification(
        userId: string,
        notificationId: string,
        tokens: Array<{ token: string; platform: string }>,
        payload: NotificationPayload,
        userLanguage: string = 'ar'
    ): Promise<void> {
        if (tokens.length === 0) return;

        const firebaseCredentials = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
        if (!firebaseCredentials) {
            console.warn('[Notifications] FCM not configured, skipping push notification');
            return;
        }

        try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const admin = require('firebase-admin');

            if (!admin.apps.length) {
                const serviceAccount = JSON.parse(firebaseCredentials);
                admin.initializeApp({
                    credential: admin.credential.cert(serviceAccount),
                });
            }

            const title = payload.titles[userLanguage] || payload.titles[FALLBACK_LANG] || '';
            const body = payload.bodies[userLanguage] || payload.bodies[FALLBACK_LANG] || '';
            const isUrgent = payload.data?.urgent === true;

            const tokenStrings = tokens.map(t => t.token);
            const message = {
                notification: { title, body },
                data: {
                    type: payload.type,
                    titles: JSON.stringify(payload.titles),
                    bodies: JSON.stringify(payload.bodies),
                    language: userLanguage,
                    ...(payload.data ? { customData: JSON.stringify(payload.data) } : {}),
                },
                tokens: tokenStrings,
                android: {
                    priority: (isUrgent ? 'high' : 'normal') as 'high' | 'normal',
                    notification: { channelId: isUrgent ? ANDROID_URGENT_CHANNEL_ID : ANDROID_CHANNEL_ID },
                },
                ...(isUrgent ? {
                    apns: { headers: { 'apns-priority': '10' } },
                } : {}),
            };

            const response = await admin.messaging().sendEachForMulticast(message);

            // Per-token bookkeeping: audit log + selective token deletion.
            // Transient failures are aggregated into a single Sentry event after
            // the loop — per-token captures would flood the quota during an FCM
            // brownout (one notification × N tokens × M users).
            const auditRows: Array<typeof notificationSendLog.$inferInsert> = [];
            const tokensToDelete: string[] = [];
            const transientErrorCounts: Record<string, number> = {};

            response.responses.forEach((resp: { success: boolean; messageId?: string; error?: { code?: string } }, idx: number) => {
                const { token, platform } = tokens[idx];
                const errorCode = resp.error?.code;

                auditRows.push({
                    notificationId,
                    userId,
                    tokenHash: hashToken(token),
                    platform,
                    fcmMessageId: resp.messageId ?? null,
                    success: resp.success,
                    errorCode: errorCode ?? null,
                });

                const verdict = classifyFcmResult(resp.success, errorCode);
                if (verdict === 'permanent_failure') {
                    tokensToDelete.push(token);
                } else if (verdict === 'transient_failure') {
                    const key = errorCode ?? 'unknown';
                    transientErrorCounts[key] = (transientErrorCounts[key] ?? 0) + 1;
                }
            });

            const transientFailureCount = Object.values(transientErrorCounts).reduce((sum, n) => sum + n, 0);
            if (transientFailureCount > 0) {
                captureError(new Error('FCM transient failures'), 'FCM send transient failures', {
                    level: 'warning',
                    tags: { service: 'notifications' },
                    extra: { transientFailureCount, errorCodeCounts: transientErrorCounts, totalTokens: tokens.length },
                });
            }

            if (auditRows.length > 0) {
                await db.insert(notificationSendLog).values(auditRows).catch(err => {
                    // Audit failures must not break the send path.
                    captureError(err, 'notification_send_log insert failed', { tags: { service: 'notifications' } });
                });
            }

            if (tokensToDelete.length > 0) {
                await db
                    .delete(deviceTokens)
                    .where(and(
                        eq(deviceTokens.userId, userId),
                        inArray(deviceTokens.token, tokensToDelete),
                    ));
            }
        } catch (error) {
            captureError(error, 'Failed to send push notification', { tags: { service: 'notifications' } });
        }
    }

    /**
     * Get notifications for a user.
     * Resolves the requested locale from the JSONB titles/bodies columns,
     * with English fallback if the locale isn't available.
     */
    async getNotifications(
        userId: string,
        limit: number = 20,
        offset: number = 0,
        lang: string = 'ar'
    ): Promise<{
        notifications: Array<{
            id: string;
            type: string;
            title: string;
            body: string;
            data: unknown;
            read: boolean;
            createdAt: Date | null;
        }>;
        unreadCount: number;
    }> {
        const notificationsList = await db
            .select({
                id: notifications.id,
                type: notifications.type,
                titles: notifications.titles,
                bodies: notifications.bodies,
                data: notifications.data,
                read: notifications.read,
                createdAt: notifications.createdAt,
            })
            .from(notifications)
            .where(eq(notifications.userId, userId))
            .orderBy(desc(notifications.createdAt))
            .limit(limit)
            .offset(offset);

        // Get unread count efficiently
        const [{ value: unreadCount }] = await db
            .select({ value: count() })
            .from(notifications)
            .where(and(
                eq(notifications.userId, userId),
                eq(notifications.read, false)
            ));

        return {
            notifications: notificationsList.map(n => {
                const titles = n.titles as Record<string, string>;
                const bodies = n.bodies as Record<string, string>;
                return {
                    id: n.id,
                    type: n.type,
                    title: titles[lang] || titles[FALLBACK_LANG] || '',
                    body: bodies[lang] || bodies[FALLBACK_LANG] || '',
                    data: n.data,
                    read: n.read ?? false,
                    createdAt: n.createdAt,
                };
            }),
            unreadCount,
        };
    }

    /**
     * Get unread notification count
     */
    async getUnreadCount(userId: string): Promise<number> {
        const [{ value }] = await db
            .select({ value: count() })
            .from(notifications)
            .where(and(
                eq(notifications.userId, userId),
                eq(notifications.read, false)
            ));

        return value;
    }

    /**
     * Mark a notification as read
     */
    async markAsRead(notificationId: string, userId: string): Promise<void> {
        await db
            .update(notifications)
            .set({ read: true })
            .where(and(
                eq(notifications.id, notificationId),
                eq(notifications.userId, userId)
            ));
    }

    /**
     * Mark all notifications as read for a user
     */
    async markAllAsRead(userId: string): Promise<void> {
        await db
            .update(notifications)
            .set({ read: true })
            .where(eq(notifications.userId, userId));
    }

    /**
     * Send a notification to every member of a workspace.
     * Used for workspace-level events (flagged reply, stale comment, etc.)
     * so team admins see the same notifications as the owner.
     */
    async sendNotificationToWorkspace(
        workspaceId: string,
        payload: NotificationPayload,
    ): Promise<void> {
        const members = await db
            .select({ userId: workspaceMembers.userId })
            .from(workspaceMembers)
            .where(eq(workspaceMembers.workspaceId, workspaceId));

        await Promise.all(
            members.map(m =>
                this.sendNotification(m.userId, payload).catch(err =>
                    captureError(err, 'Failed to send workspace notification to member', {
                        tags: { service: 'notifications' },
                        extra: { workspaceId, userId: m.userId },
                    }),
                ),
            ),
        );
    }

    /**
     * Send a template notification to every member of a workspace.
     */
    async sendTemplateNotificationToWorkspace(
        workspaceId: string,
        type: NotificationType,
        variables: Record<string, string> = {},
        data?: Record<string, unknown>,
    ): Promise<void> {
        return this.sendNotificationToWorkspace(workspaceId, buildTemplatePayload(type, variables, data));
    }
}

export const notificationService = new NotificationService();
