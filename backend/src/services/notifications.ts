import { db } from '../db';
import { deviceTokens, notifications, settings } from '../db/schema';
import { eq, and, desc, count } from 'drizzle-orm';
import { captureError } from '../utils/sentryHelpers';

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
    | 'kb_gap';

export interface NotificationPayload {
    type: NotificationType;
    titleEn: string;
    titleAr: string;
    bodyEn: string;
    bodyAr: string;
    data?: Record<string, unknown>;
}

// Notification templates
export const NOTIFICATION_TEMPLATES: Record<NotificationType, Omit<NotificationPayload, 'type' | 'data'>> = {
    payment_failed: {
        titleEn: 'Payment Failed',
        titleAr: 'فشل الدفع',
        bodyEn: 'We couldn\'t process your payment. Please update your payment method to continue using Jawab24.',
        bodyAr: 'لم نتمكن من معالجة الدفع. يرجى تحديث طريقة الدفع لمواصلة استخدام Jawab24.',
    },
    subscription_expiring: {
        titleEn: 'Subscription Expiring Soon',
        titleAr: 'اشتراكك ينتهي قريباً',
        bodyEn: 'Your subscription expires in {days} days. Renew now to avoid service interruption.',
        bodyAr: 'ينتهي اشتراكك خلال {days} أيام. جدد الآن لتجنب انقطاع الخدمة.',
    },
    page_disconnected: {
        titleEn: 'Page Disconnected',
        titleAr: 'تم فصل الصفحة',
        bodyEn: 'Your page \'{pageName}\' has been disconnected. Please reconnect to resume auto-replies.',
        bodyAr: 'تم فصل صفحتك \'{pageName}\'. يرجى إعادة الاتصال لاستئناف الرد التلقائي.',
    },
    subscription_renewed: {
        titleEn: 'Subscription Renewed',
        titleAr: 'تم تجديد الاشتراك',
        bodyEn: 'Your subscription has been successfully renewed. Thank you for using Jawab24!',
        bodyAr: 'تم تجديد اشتراكك بنجاح. شكراً لاستخدامك Jawab24!',
    },
    trial_ending: {
        titleEn: 'Trial Ending Soon',
        titleAr: 'تنتهي الفترة التجريبية قريباً',
        bodyEn: 'Your free trial ends in {days} days. Subscribe now to keep using Jawab24.',
        bodyAr: 'تنتهي فترتك التجريبية المجانية خلال {days} أيام. اشترك الآن للاستمرار في استخدام Jawab24.',
    },
    flagged_reply: {
        titleEn: 'Reply Needs Your Attention',
        titleAr: 'رد يحتاج انتباهك',
        bodyEn: 'An AI reply to "{senderName}" was flagged: {reason}. Please review it.',
        bodyAr: 'تم وضع علامة على رد لـ "{senderName}": {reason}. يرجى مراجعته.',
    },
    skipped_reply: {
        titleEn: 'Auto-Reply Skipped',
        titleAr: 'تم تخطي الرد التلقائي',
        bodyEn: 'A reply to "{senderName}" was skipped: {reason}. Please review and reply manually.',
        bodyAr: 'تم تخطي الرد التلقائي لـ "{senderName}": {reason}. يرجى مراجعته والرد يدوياً.',
    },
    new_comment: {
        titleEn: 'New Comment',
        titleAr: 'تعليق جديد',
        bodyEn: 'New comment from {senderName} is waiting for your reply.',
        bodyAr: 'تعليق جديد من {senderName} بانتظار ردك.',
    },
    stale_comment: {
        titleEn: 'Unreplied Comments Need Attention',
        titleAr: 'تعليقات بدون رد تحتاج انتباهك',
        bodyEn: '{count} comments waiting for your reply for over {minutes} minutes.',
        bodyAr: '{count} تعليقات بانتظار ردك منذ أكثر من {minutes} دقيقة.',
    },
    kb_gap: {
        titleEn: 'Knowledge Base Gap Detected',
        titleAr: 'فجوة في قاعدة المعرفة',
        bodyEn: 'Customers on "{pageName}" keep asking about "{topic}" but your knowledge base doesn\'t cover it.',
        bodyAr: 'عملاء "{pageName}" يسألون عن "{topic}" لكن قاعدة المعرفة لا تغطي هذا الموضوع.',
    },
};

/** Arabic translations for flag reason strings used in notifications */
const FLAG_REASON_AR: Record<string, string> = {
    'offensive_or_abusive': 'محتوى مسيء',
    'angry_customer': 'عميل غاضب',
    'low_confidence': 'ثقة منخفضة في الرد',
    'held_low_confidence': 'ثقة منخفضة في الرد',
    'price_not_in_kb': 'سعر غير موجود في قاعدة المعرفة',
    'info_not_in_kb': 'معلومات غير موجودة في قاعدة المعرفة',
    'redirect_to_human': 'تحويل إلى موظف',
    'complaint': 'شكوى',
    'offensive': 'محتوى مسيء',
    'invalid_json': 'خطأ في معالجة الرد',
    'fallback_reply': 'رد احتياطي',
    'AI flagged this reply': 'تم تمييز هذا الرد بواسطة الذكاء الاصطناعي',
};

/** Arabic fallback for 'Unknown' sender name */
const UNKNOWN_SENDER_AR = 'مجهول';

function translateFlagReason(reason: string): string {
    return reason.split(',')
        .map(f => FLAG_REASON_AR[f.trim()] || f.trim())
        .join('، ');
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
            // Insert new token
            await db.insert(deviceTokens).values({
                userId,
                token,
                platform,
            });
        }
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
     * Get all device tokens for a user
     */
    async getUserDeviceTokens(userId: string): Promise<string[]> {
        const tokens = await db
            .select({ token: deviceTokens.token })
            .from(deviceTokens)
            .where(eq(deviceTokens.userId, userId));
        
        return tokens.map(t => t.token);
    }

    /**
     * Create and send a notification to a user
     * Uses user's preferred language for push notifications
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
                titleEn: payload.titleEn,
                titleAr: payload.titleAr,
                bodyEn: payload.bodyEn,
                bodyAr: payload.bodyAr,
                data: payload.data || {},
            })
            .returning({ id: notifications.id });

        // 2. Get user's device tokens and language preference
        const [tokens, userLanguage] = await Promise.all([
            this.getUserDeviceTokens(userId),
            this.getUserLanguage(userId),
        ]);

        // 3. Send push notification via FCM (if tokens exist and FCM is configured)
        if (tokens.length > 0) {
            await this.sendPushNotification(tokens, payload, userLanguage);
        }

        return notification.id;
    }

    /**
     * Send notification using a template
     */
    async sendTemplateNotification(
        userId: string,
        type: NotificationType,
        variables: Record<string, string> = {},
        data?: Record<string, unknown>
    ): Promise<string> {
        const template = NOTIFICATION_TEMPLATES[type];
        
        // Replace variables in templates
        let titleEn = template.titleEn;
        let titleAr = template.titleAr;
        let bodyEn = template.bodyEn;
        let bodyAr = template.bodyAr;

        for (const [key, value] of Object.entries(variables)) {
            const placeholder = `{${key}}`;
            titleEn = titleEn.replace(placeholder, value);
            bodyEn = bodyEn.replace(placeholder, value);
            if (key === 'reason') {
                const arValue = translateFlagReason(value);
                titleAr = titleAr.replace(placeholder, arValue);
                bodyAr = bodyAr.replace(placeholder, arValue);
            } else if (key === 'senderName' && value === 'Unknown') {
                titleAr = titleAr.replace(placeholder, UNKNOWN_SENDER_AR);
                bodyAr = bodyAr.replace(placeholder, UNKNOWN_SENDER_AR);
            } else {
                titleAr = titleAr.replace(placeholder, value);
                bodyAr = bodyAr.replace(placeholder, value);
            }
        }

        return this.sendNotification(userId, {
            type,
            titleEn,
            titleAr,
            bodyEn,
            bodyAr,
            data,
        });
    }

    /**
     * Get user's preferred language from settings
     */
    private async getUserLanguage(userId: string): Promise<'ar' | 'en'> {
        try {
            const [userSettings] = await db
                .select({ dashboardLanguage: settings.dashboardLanguage })
                .from(settings)
                .where(eq(settings.userId, userId))
                .limit(1);
            
            return (userSettings?.dashboardLanguage === 'en' ? 'en' : 'ar') as 'ar' | 'en';
        } catch {
            return 'ar'; // Default to Arabic
        }
    }

    /**
     * Send push notification via FCM
     * Uses user's preferred language for the notification display
     */
    private async sendPushNotification(
        tokens: string[],
        payload: NotificationPayload,
        userLanguage: 'ar' | 'en' = 'ar'
    ): Promise<void> {
        // Check if Firebase Admin is configured
        const firebaseCredentials = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
        
        if (!firebaseCredentials) {
            // FCM not configured - skip push notification
            // This is expected during development or before Firebase setup
            console.warn('[Notifications] FCM not configured, skipping push notification');
            return;
        }

        try {
            // Dynamic import to avoid errors when firebase-admin isn't installed
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const admin = require('firebase-admin');
            
            // Initialize Firebase Admin if not already initialized
            if (!admin.apps.length) {
                const serviceAccount = JSON.parse(firebaseCredentials);
                admin.initializeApp({
                    credential: admin.credential.cert(serviceAccount),
                });
            }

            // Use user's preferred language for notification display
            const title = userLanguage === 'ar' ? payload.titleAr : payload.titleEn;
            const body = userLanguage === 'ar' ? payload.bodyAr : payload.bodyEn;

            // Send to all tokens
            const message = {
                notification: {
                    title,
                    body,
                },
                data: {
                    type: payload.type,
                    titleEn: payload.titleEn,
                    titleAr: payload.titleAr,
                    bodyEn: payload.bodyEn,
                    bodyAr: payload.bodyAr,
                    language: userLanguage,
                    ...(payload.data ? { customData: JSON.stringify(payload.data) } : {}),
                },
                tokens,
            };

            const response = await admin.messaging().sendEachForMulticast(message);
            
            // Handle failed tokens (remove invalid ones)
            if (response.failureCount > 0) {
                const failedTokens: string[] = [];
                response.responses.forEach((resp: { success: boolean }, idx: number) => {
                    if (!resp.success) {
                        failedTokens.push(tokens[idx]);
                    }
                });
                
                // Remove invalid tokens from database
                for (const token of failedTokens) {
                    await db
                        .delete(deviceTokens)
                        .where(eq(deviceTokens.token, token));
                }
            }
        } catch (error) {
            captureError(error, 'Failed to send push notification', { tags: { service: 'notifications' } });
            // Don't throw - push notification failure shouldn't break the main flow
        }
    }

    /**
     * Get notifications for a user.
     * Accepts a lang parameter to return only the relevant title/body,
     * avoiding sending unused language data over the wire.
     */
    async getNotifications(
        userId: string,
        limit: number = 20,
        offset: number = 0,
        lang: 'ar' | 'en' = 'ar'
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
        // Select only needed columns
        const notificationsList = await db
            .select({
                id: notifications.id,
                type: notifications.type,
                titleEn: notifications.titleEn,
                titleAr: notifications.titleAr,
                bodyEn: notifications.bodyEn,
                bodyAr: notifications.bodyAr,
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
            notifications: notificationsList.map(n => ({
                id: n.id,
                type: n.type,
                title: lang === 'ar' ? n.titleAr : n.titleEn,
                body: lang === 'ar' ? n.bodyAr : n.bodyEn,
                data: n.data,
                read: n.read ?? false,
                createdAt: n.createdAt,
            })),
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
}

export const notificationService = new NotificationService();
