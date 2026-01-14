import { db } from '../db';
import { deviceTokens, notifications, users } from '../db/schema';
import { eq, and, desc } from 'drizzle-orm';

// Notification types
export type NotificationType = 
    | 'payment_failed'
    | 'subscription_expiring'
    | 'page_disconnected'
    | 'subscription_renewed'
    | 'trial_ending';

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
};

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

        // 2. Get user's device tokens
        const tokens = await this.getUserDeviceTokens(userId);

        // 3. Send push notification via FCM (if tokens exist and FCM is configured)
        if (tokens.length > 0) {
            await this.sendPushNotification(tokens, payload);
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
            titleAr = titleAr.replace(placeholder, value);
            bodyEn = bodyEn.replace(placeholder, value);
            bodyAr = bodyAr.replace(placeholder, value);
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
     * Send push notification via FCM
     * Note: This is a placeholder - FCM requires google-services.json and firebase-admin setup
     * Firebase Admin SDK must be installed separately: npm install firebase-admin
     */
    private async sendPushNotification(
        tokens: string[],
        payload: NotificationPayload
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

            // Send to all tokens
            const message = {
                notification: {
                    title: payload.titleEn, // FCM will use device language preference
                    body: payload.bodyEn,
                },
                data: {
                    type: payload.type,
                    titleEn: payload.titleEn,
                    titleAr: payload.titleAr,
                    bodyEn: payload.bodyEn,
                    bodyAr: payload.bodyAr,
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
            console.error('[Notifications] Failed to send push notification:', error);
            // Don't throw - push notification failure shouldn't break the main flow
        }
    }

    /**
     * Get notifications for a user
     */
    async getNotifications(
        userId: string,
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
            createdAt: Date | null;
        }>;
        unreadCount: number;
    }> {
        // Get notifications
        const notificationsList = await db
            .select()
            .from(notifications)
            .where(eq(notifications.userId, userId))
            .orderBy(desc(notifications.createdAt))
            .limit(limit)
            .offset(offset);

        // Get unread count
        const unreadResult = await db
            .select()
            .from(notifications)
            .where(and(
                eq(notifications.userId, userId),
                eq(notifications.read, false)
            ));

        return {
            notifications: notificationsList.map(n => ({
                id: n.id,
                type: n.type,
                titleEn: n.titleEn,
                titleAr: n.titleAr,
                bodyEn: n.bodyEn,
                bodyAr: n.bodyAr,
                data: n.data,
                read: n.read ?? false,
                createdAt: n.createdAt,
            })),
            unreadCount: unreadResult.length,
        };
    }

    /**
     * Get unread notification count
     */
    async getUnreadCount(userId: string): Promise<number> {
        const result = await db
            .select()
            .from(notifications)
            .where(and(
                eq(notifications.userId, userId),
                eq(notifications.read, false)
            ));

        return result.length;
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
