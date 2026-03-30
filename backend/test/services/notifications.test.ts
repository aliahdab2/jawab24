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
            expect(NOTIFICATION_TEMPLATES).toHaveProperty('stale_message');
        });

        it('should have skipped_reply template with correct placeholders', () => {
            const template = NOTIFICATION_TEMPLATES.skipped_reply;
            expect(template.titles.en).toBe('Auto-Reply Skipped');
            expect(template.titles.ar).toBe('تم تخطي الرد التلقائي');
            expect(template.bodies.en).toContain('{senderName}');
            expect(template.bodies.en).toContain('{reason}');
            expect(template.bodies.ar).toContain('{senderName}');
            expect(template.bodies.ar).toContain('{reason}');
        });

        it('should have flagged_reply template with correct placeholders', () => {
            const template = NOTIFICATION_TEMPLATES.flagged_reply;
            expect(template.titles.en).toBe('Reply Needs Your Attention');
            expect(template.bodies.en).toContain('{senderName}');
            expect(template.bodies.en).toContain('{reason}');
            expect(template.bodies.ar).toContain('{senderName}');
            expect(template.bodies.ar).toContain('{reason}');
        });

        it('should have stale_comment template with correct placeholders', () => {
            const template = NOTIFICATION_TEMPLATES.stale_comment;
            expect(template.titles.en).toContain('{senderName}');
            expect(template.titles.en).toContain('{pageName}');
            expect(template.bodies.en).toContain('{preview}');
            expect(template.bodies.ar).toContain('{preview}');
        });

        it('should have kb_gap template with correct placeholders', () => {
            expect(NOTIFICATION_TEMPLATES).toHaveProperty('kb_gap');
            const template = NOTIFICATION_TEMPLATES.kb_gap;
            expect(template.titles.en).toBe('Knowledge Base Gap Detected');
            expect(template.titles.ar).toBe('فجوة في قاعدة المعرفة');
            expect(template.bodies.en).toContain('{pageName}');
            expect(template.bodies.en).toContain('{topic}');
            expect(template.bodies.ar).toContain('{pageName}');
            expect(template.bodies.ar).toContain('{topic}');
        });

        it('should have titles and bodies for each locale in every template', () => {
            for (const [, template] of Object.entries(NOTIFICATION_TEMPLATES)) {
                expect(template.titles.en).toBeDefined();
                expect(template.titles.ar).toBeDefined();
                expect(template.bodies.en).toBeDefined();
                expect(template.bodies.ar).toBeDefined();
                expect(template.titles.en.length).toBeGreaterThan(0);
                expect(template.titles.ar.length).toBeGreaterThan(0);
            }
        });
    });

    describe('registerDeviceToken', () => {
        it('should insert a new token if it does not exist', async () => {
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
        it('should store notification in database with JSONB titles/bodies', async () => {
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
                titles: { en: 'Payment Failed', ar: 'فشل الدفع' },
                bodies: { en: 'Your payment could not be processed.', ar: 'لم نتمكن من معالجة الدفع.' },
            });

            expect(result).toBe('notif-123');
            expect(db.insert).toHaveBeenCalled();
        });
    });

    describe('sendTemplateNotification', () => {
        it('should replace variables in template', async () => {
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

            const sendNotificationSpy = vi.spyOn(notificationService, 'sendNotification');

            await notificationService.sendTemplateNotification(
                'user-123',
                'subscription_expiring',
                { days: '3' }
            );

            expect(sendNotificationSpy).toHaveBeenCalledWith('user-123', expect.objectContaining({
                type: 'subscription_expiring',
                bodies: expect.objectContaining({
                    en: expect.stringContaining('3 days'),
                    ar: expect.stringContaining('3'),
                }),
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
                bodies: expect.objectContaining({
                    en: expect.stringContaining('Angry Customer'),
                }),
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
            expect(payload.bodies.ar).toContain('عميل غاضب');
            expect(payload.bodies.ar).not.toContain('angry_customer');
            expect(payload.bodies.en).toContain('Angry Customer');
            expect(payload.bodies.en).not.toContain('angry_customer');
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
            expect(payload.bodies.ar).toContain('محتوى مسيء');
            expect(payload.bodies.ar).toContain('ثقة منخفضة في الرد');
            expect(payload.bodies.ar).toContain('، '); // Arabic comma separator
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
            expect(payload.bodies.ar).toContain('some_unknown_flag');
        });

        it('should translate enriched reason like "Cancellation Request — order #5678" to Arabic', async () => {
            (db.select as any).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([]),
                }),
            });

            (db.insert as any).mockReturnValue({
                values: vi.fn().mockReturnValue({
                    returning: vi.fn().mockResolvedValue([{ id: 'notif-enrich' }]),
                }),
            });

            const sendNotificationSpy = vi.spyOn(notificationService, 'sendNotification');

            await notificationService.sendTemplateNotification(
                'user-123',
                'flagged_reply',
                { senderName: 'Customer', reason: 'Cancellation Request — order #5678' },
            );

            const payload = sendNotificationSpy.mock.calls[0][1];
            expect(payload.bodies.ar).toContain('طلب إلغاء');
            expect(payload.bodies.ar).toContain('5678');
            expect(payload.bodies.en).toContain('Cancellation Request — order #5678');
        });

        it('should translate new high-stakes flags (cancellation, refund, exchange)', async () => {
            (db.select as any).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([]),
                }),
            });

            (db.insert as any).mockReturnValue({
                values: vi.fn().mockReturnValue({
                    returning: vi.fn().mockResolvedValue([{ id: 'notif-hs' }]),
                }),
            });

            const sendNotificationSpy = vi.spyOn(notificationService, 'sendNotification');

            for (const [flag, arTranslation] of [
                ['Cancellation Request', 'طلب إلغاء'],
                ['Refund Request', 'طلب استرجاع'],
                ['Exchange Request', 'طلب استبدال'],
            ] as const) {
                sendNotificationSpy.mockClear();

                await notificationService.sendTemplateNotification(
                    'user-123',
                    'flagged_reply',
                    { senderName: 'Test', reason: flag },
                );

                const payload = sendNotificationSpy.mock.calls[0][1];
                expect(payload.bodies.ar).toContain(arTranslation);
            }
        });

        it('should pass urgent data through to sendNotification payload', async () => {
            (db.select as any).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([]),
                }),
            });

            (db.insert as any).mockReturnValue({
                values: vi.fn().mockReturnValue({
                    returning: vi.fn().mockResolvedValue([{ id: 'notif-urgent' }]),
                }),
            });

            const sendNotificationSpy = vi.spyOn(notificationService, 'sendNotification');

            await notificationService.sendTemplateNotification(
                'user-123',
                'flagged_reply',
                { senderName: 'Customer', reason: 'Cancellation Request' },
                { messageId: 'msg-1', type: 'message', urgent: true },
            );

            const payload = sendNotificationSpy.mock.calls[0][1];
            expect(payload.data).toEqual(expect.objectContaining({ urgent: true }));
        });
    });

    describe('getNotifications', () => {
        const mockNotification = {
            id: 'notif-1',
            type: 'payment_failed',
            titles: { en: 'Payment Failed', ar: 'فشل الدفع' },
            bodies: { en: 'Body en', ar: 'Body ar' },
            data: {},
            read: false,
            createdAt: new Date(),
        };

        function setupGetNotificationsMocks(notifs = [mockNotification], unreadCount = 1) {
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
            expect(result.notifications[0]).not.toHaveProperty('titles');
            expect(result.notifications[0]).not.toHaveProperty('bodies');
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

        it('should fallback to English when requested locale is missing', async () => {
            setupGetNotificationsMocks();

            const result = await notificationService.getNotifications('user-123', 20, 0, 'fr');

            expect(result.notifications[0].title).toBe('Payment Failed');
            expect(result.notifications[0].body).toBe('Body en');
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
            (db.select as any).mockReturnValueOnce({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([]),
                }),
            });
            (db.select as any).mockReturnValueOnce({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([{ dashboardLanguage: 'ar' }]),
                    }),
                }),
            });
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
            expect(payload.bodies.ar).toContain('تم تمييز هذا الرد بواسطة الذكاء الاصطناعي');
            expect(payload.bodies.ar).not.toContain('AI flagged');
        });

        it('should translate "Unknown" sender to Arabic', async () => {
            setupSendNotificationMocks();
            const spy = vi.spyOn(notificationService, 'sendNotification');

            await notificationService.sendTemplateNotification('user-1', 'flagged_reply', {
                senderName: 'Unknown', reason: 'offensive',
            });

            const payload = spy.mock.calls[0][1];
            expect(payload.bodies.ar).toContain('مجهول');
            expect(payload.bodies.ar).not.toContain('Unknown');
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
                const bodyWithoutBrand = payload.bodies.ar.replace(/Jawab24/g, '');
                expect(bodyWithoutBrand).not.toMatch(/[a-zA-Z]{3,}/);
            }
        });
    });
});
