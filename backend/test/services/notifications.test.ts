import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock the database before importing the service
vi.mock('../../src/db', () => ({
    db: {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        offset: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([{ id: 'notif-123' }]),
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        delete: vi.fn().mockReturnThis(),
    },
}));

// Import after mocking
import { notificationService, NOTIFICATION_TEMPLATES } from '../../src/services/notifications';
import { db } from '../../src/db';

describe('NotificationService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.resetAllMocks();
    });

    describe('NOTIFICATION_TEMPLATES', () => {
        it('should have all required notification types', () => {
            expect(NOTIFICATION_TEMPLATES).toHaveProperty('payment_failed');
            expect(NOTIFICATION_TEMPLATES).toHaveProperty('subscription_expiring');
            expect(NOTIFICATION_TEMPLATES).toHaveProperty('page_disconnected');
            expect(NOTIFICATION_TEMPLATES).toHaveProperty('subscription_renewed');
            expect(NOTIFICATION_TEMPLATES).toHaveProperty('trial_ending');
            expect(NOTIFICATION_TEMPLATES).toHaveProperty('flagged_reply');
            expect(NOTIFICATION_TEMPLATES).toHaveProperty('skipped_reply');
            expect(NOTIFICATION_TEMPLATES).toHaveProperty('new_comment');
            expect(NOTIFICATION_TEMPLATES).toHaveProperty('stale_comment');
        });

        it('should have skipped_reply template with correct placeholders', () => {
            const template = NOTIFICATION_TEMPLATES.skipped_reply;
            expect(template.titleEn).toBe('Auto-Reply Skipped');
            expect(template.titleAr).toBe('تم تخطي الرد التلقائي');
            expect(template.bodyEn).toContain('{senderName}');
            expect(template.bodyEn).toContain('{reason}');
            expect(template.bodyAr).toContain('{senderName}');
            expect(template.bodyAr).toContain('{reason}');
        });

        it('should have flagged_reply template with correct placeholders', () => {
            const template = NOTIFICATION_TEMPLATES.flagged_reply;
            expect(template.titleEn).toBe('Reply Needs Your Attention');
            expect(template.bodyEn).toContain('{senderName}');
            expect(template.bodyEn).toContain('{reason}');
            expect(template.bodyAr).toContain('{senderName}');
            expect(template.bodyAr).toContain('{reason}');
        });

        it('should have stale_comment template with correct placeholders', () => {
            const template = NOTIFICATION_TEMPLATES.stale_comment;
            expect(template.titleEn).toBe('Unreplied Comments Need Attention');
            expect(template.bodyEn).toContain('{count}');
            expect(template.bodyEn).toContain('{minutes}');
            expect(template.bodyAr).toContain('{count}');
            expect(template.bodyAr).toContain('{minutes}');
        });

        it('should have bilingual content for each template', () => {
            for (const [key, template] of Object.entries(NOTIFICATION_TEMPLATES)) {
                expect(template.titleEn).toBeDefined();
                expect(template.titleAr).toBeDefined();
                expect(template.bodyEn).toBeDefined();
                expect(template.bodyAr).toBeDefined();
                expect(template.titleEn.length).toBeGreaterThan(0);
                expect(template.titleAr.length).toBeGreaterThan(0);
            }
        });
    });

    describe('registerDeviceToken', () => {
        it('should insert a new token if it does not exist', async () => {
            // Mock: no existing token
            (db.select as any).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([]),
                    }),
                }),
            });

            (db.insert as any).mockReturnValue({
                values: vi.fn().mockResolvedValue(undefined),
            });

            await notificationService.registerDeviceToken('user-123', 'fcm-token-abc', 'android');

            expect(db.insert).toHaveBeenCalled();
        });

        it('should update lastUsedAt if token already exists', async () => {
            // Mock: existing token found
            (db.select as any).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([{ id: 'token-1', token: 'fcm-token-abc' }]),
                    }),
                }),
            });

            (db.update as any).mockReturnValue({
                set: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue(undefined),
                }),
            });

            await notificationService.registerDeviceToken('user-123', 'fcm-token-abc', 'android');

            expect(db.update).toHaveBeenCalled();
        });
    });

    describe('removeDeviceToken', () => {
        it('should delete the specified token', async () => {
            (db.delete as any).mockReturnValue({
                where: vi.fn().mockResolvedValue(undefined),
            });

            await notificationService.removeDeviceToken('user-123', 'fcm-token-abc');

            expect(db.delete).toHaveBeenCalled();
        });
    });

    describe('sendNotification', () => {
        it('should store notification in database', async () => {
            // Mock: no device tokens (skip push)
            (db.select as any).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([]),
                }),
            });

            (db.insert as any).mockReturnValue({
                values: vi.fn().mockReturnValue({
                    returning: vi.fn().mockResolvedValue([{ id: 'notif-123' }]),
                }),
            });

            const result = await notificationService.sendNotification('user-123', {
                type: 'payment_failed',
                titleEn: 'Payment Failed',
                titleAr: 'فشل الدفع',
                bodyEn: 'Your payment could not be processed.',
                bodyAr: 'لم نتمكن من معالجة الدفع.',
            });

            expect(result).toBe('notif-123');
            expect(db.insert).toHaveBeenCalled();
        });
    });

    describe('sendTemplateNotification', () => {
        it('should replace variables in template', async () => {
            // Mock database calls
            (db.select as any).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([]),
                }),
            });

            (db.insert as any).mockReturnValue({
                values: vi.fn().mockReturnValue({
                    returning: vi.fn().mockResolvedValue([{ id: 'notif-456' }]),
                }),
            });

            // Spy on sendNotification to capture the payload
            const sendNotificationSpy = vi.spyOn(notificationService, 'sendNotification');

            await notificationService.sendTemplateNotification(
                'user-123',
                'subscription_expiring',
                { days: '3' }
            );

            expect(sendNotificationSpy).toHaveBeenCalledWith('user-123', expect.objectContaining({
                type: 'subscription_expiring',
                bodyEn: expect.stringContaining('3 days'),
                bodyAr: expect.stringContaining('3'),
            }));
        });

        it('should replace variables in flagged_reply template', async () => {
            (db.select as any).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([]),
                }),
            });

            (db.insert as any).mockReturnValue({
                values: vi.fn().mockReturnValue({
                    returning: vi.fn().mockResolvedValue([{ id: 'notif-789' }]),
                }),
            });

            const sendNotificationSpy = vi.spyOn(notificationService, 'sendNotification');

            await notificationService.sendTemplateNotification(
                'user-123',
                'flagged_reply',
                { senderName: 'Ahmed', reason: 'angry_customer' },
                { commentId: 'c-123', type: 'comment', deepLink: '/comments?filter=flagged' }
            );

            expect(sendNotificationSpy).toHaveBeenCalledWith('user-123', expect.objectContaining({
                type: 'flagged_reply',
                bodyEn: expect.stringContaining('angry_customer'),
                data: expect.objectContaining({
                    commentId: 'c-123',
                    type: 'comment',
                }),
            }));
        });

        it('should translate flag reason to Arabic in Arabic notification body', async () => {
            (db.select as any).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([]),
                }),
            });

            (db.insert as any).mockReturnValue({
                values: vi.fn().mockReturnValue({
                    returning: vi.fn().mockResolvedValue([{ id: 'notif-ar' }]),
                }),
            });

            const sendNotificationSpy = vi.spyOn(notificationService, 'sendNotification');

            await notificationService.sendTemplateNotification(
                'user-123',
                'flagged_reply',
                { senderName: 'Ahmed', reason: 'angry_customer' },
            );

            const payload = sendNotificationSpy.mock.calls[0][1];
            // Arabic body should have Arabic translation, not English
            expect(payload.bodyAr).toContain('عميل غاضب');
            expect(payload.bodyAr).not.toContain('angry_customer');
            // English body should keep the raw reason
            expect(payload.bodyEn).toContain('angry_customer');
        });

        it('should translate comma-separated flag reasons to Arabic', async () => {
            (db.select as any).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([]),
                }),
            });

            (db.insert as any).mockReturnValue({
                values: vi.fn().mockReturnValue({
                    returning: vi.fn().mockResolvedValue([{ id: 'notif-multi' }]),
                }),
            });

            const sendNotificationSpy = vi.spyOn(notificationService, 'sendNotification');

            await notificationService.sendTemplateNotification(
                'user-123',
                'flagged_reply',
                { senderName: 'Test', reason: 'offensive_or_abusive,low_confidence' },
            );

            const payload = sendNotificationSpy.mock.calls[0][1];
            expect(payload.bodyAr).toContain('محتوى مسيء');
            expect(payload.bodyAr).toContain('ثقة منخفضة في الرد');
            expect(payload.bodyAr).toContain('، '); // Arabic comma separator
        });

        it('should fall back to raw reason when no translation exists', async () => {
            (db.select as any).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([]),
                }),
            });

            (db.insert as any).mockReturnValue({
                values: vi.fn().mockReturnValue({
                    returning: vi.fn().mockResolvedValue([{ id: 'notif-raw' }]),
                }),
            });

            const sendNotificationSpy = vi.spyOn(notificationService, 'sendNotification');

            await notificationService.sendTemplateNotification(
                'user-123',
                'flagged_reply',
                { senderName: 'Test', reason: 'some_unknown_flag' },
            );

            const payload = sendNotificationSpy.mock.calls[0][1];
            // Should fall back to the raw string
            expect(payload.bodyAr).toContain('some_unknown_flag');
        });
    });

    describe('getNotifications', () => {
        const mockNotification = {
            id: 'notif-1',
            type: 'payment_failed',
            titleEn: 'Payment Failed',
            titleAr: 'فشل الدفع',
            bodyEn: 'Body en',
            bodyAr: 'Body ar',
            data: {},
            read: false,
            createdAt: new Date(),
        };

        function setupGetNotificationsMocks(notifs = [mockNotification], unreadCount = 1) {
            // Mock for notifications list (select specific columns)
            (db.select as any).mockReturnValueOnce({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        orderBy: vi.fn().mockReturnValue({
                            limit: vi.fn().mockReturnValue({
                                offset: vi.fn().mockResolvedValue(notifs),
                            }),
                        }),
                    }),
                }),
            });

            // Mock for unread count (uses SQL count())
            (db.select as any).mockReturnValueOnce({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([{ value: unreadCount }]),
                }),
            });
        }

        it('should return notifications and unread count', async () => {
            setupGetNotificationsMocks();

            const result = await notificationService.getNotifications('user-123', 20, 0);

            expect(result.notifications).toHaveLength(1);
            expect(result.notifications[0].type).toBe('payment_failed');
            expect(result.unreadCount).toBe(1);
        });

        it('should return Arabic title/body when lang=ar', async () => {
            setupGetNotificationsMocks();

            const result = await notificationService.getNotifications('user-123', 20, 0, 'ar');

            expect(result.notifications[0].title).toBe('فشل الدفع');
            expect(result.notifications[0].body).toBe('Body ar');
            expect(result.notifications[0]).not.toHaveProperty('titleEn');
            expect(result.notifications[0]).not.toHaveProperty('titleAr');
        });

        it('should return English title/body when lang=en', async () => {
            setupGetNotificationsMocks();

            const result = await notificationService.getNotifications('user-123', 20, 0, 'en');

            expect(result.notifications[0].title).toBe('Payment Failed');
            expect(result.notifications[0].body).toBe('Body en');
        });

        it('should default to Arabic when lang not specified', async () => {
            setupGetNotificationsMocks();

            const result = await notificationService.getNotifications('user-123', 20, 0);

            expect(result.notifications[0].title).toBe('فشل الدفع');
        });
    });

    describe('markAsRead', () => {
        it('should update read status to true', async () => {
            (db.update as any).mockReturnValue({
                set: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue(undefined),
                }),
            });

            await notificationService.markAsRead('notif-123', 'user-123');

            expect(db.update).toHaveBeenCalled();
        });
    });

    describe('markAllAsRead', () => {
        it('should mark all notifications as read for user', async () => {
            (db.update as any).mockReturnValue({
                set: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue(undefined),
                }),
            });

            await notificationService.markAllAsRead('user-123');

            expect(db.update).toHaveBeenCalled();
        });
    });

    describe('getUnreadCount', () => {
        it('should return count of unread notifications', async () => {
            (db.select as any).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([{ value: 3 }]),
                }),
            });

            const count = await notificationService.getUnreadCount('user-123');

            expect(count).toBe(3);
        });

        it('should return 0 when no unread notifications', async () => {
            (db.select as any).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([{ value: 0 }]),
                }),
            });

            const count = await notificationService.getUnreadCount('user-123');

            expect(count).toBe(0);
        });
    });

    describe('Arabic translations in templates', () => {
        function setupSendNotificationMocks() {
            // Mock for device tokens (no tokens, skip push)
            (db.select as any).mockReturnValueOnce({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([]),
                }),
            });
            // Mock for user language
            (db.select as any).mockReturnValueOnce({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([{ dashboardLanguage: 'ar' }]),
                    }),
                }),
            });
            // Mock for insert notification
            (db.insert as any).mockReturnValue({
                values: vi.fn().mockReturnValue({
                    returning: vi.fn().mockResolvedValue([{ id: 'notif-test' }]),
                }),
            });
        }

        it('should translate "AI flagged this reply" reason to Arabic', async () => {
            setupSendNotificationMocks();
            const spy = vi.spyOn(notificationService, 'sendNotification');

            await notificationService.sendTemplateNotification('user-1', 'flagged_reply', {
                senderName: 'Ahmed', reason: 'AI flagged this reply',
            });

            const payload = spy.mock.calls[0][1];
            expect(payload.bodyAr).toContain('تم تمييز هذا الرد بواسطة الذكاء الاصطناعي');
            expect(payload.bodyAr).not.toContain('AI flagged');
        });

        it('should translate "Unknown" sender to Arabic', async () => {
            setupSendNotificationMocks();
            const spy = vi.spyOn(notificationService, 'sendNotification');

            await notificationService.sendTemplateNotification('user-1', 'flagged_reply', {
                senderName: 'Unknown', reason: 'offensive',
            });

            const payload = spy.mock.calls[0][1];
            expect(payload.bodyAr).toContain('مجهول');
            expect(payload.bodyAr).not.toContain('Unknown');
        });

        it('should not contain English words in Arabic body for known reasons', async () => {
            const spy = vi.spyOn(notificationService, 'sendNotification');
            const knownReasons = [
                'offensive_or_abusive', 'angry_customer', 'low_confidence',
                'price_not_in_kb', 'redirect_to_human', 'complaint', 'offensive',
                'invalid_json', 'fallback_reply', 'AI flagged this reply',
            ];

            for (const reason of knownReasons) {
                spy.mockClear();
                setupSendNotificationMocks();

                await notificationService.sendTemplateNotification('user-1', 'skipped_reply', {
                    senderName: 'أحمد', reason,
                });

                const payload = spy.mock.calls[0][1];
                // Arabic body should not have 3+ consecutive English letters (except brand names)
                const bodyWithoutBrand = payload.bodyAr.replace(/Jawab24/g, '');
                expect(bodyWithoutBrand).not.toMatch(/[a-zA-Z]{3,}/);
            }
        });
    });
});
