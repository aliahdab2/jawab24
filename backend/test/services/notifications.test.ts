import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock Redis before importing the service (notifications.ts uses redis.set for push rate-limiting)
// vi.hoisted ensures the variable is initialized before vi.mock's factory runs
const { mockRedisSet, mockRedisIncr } = vi.hoisted(() => ({
    mockRedisSet: vi.fn().mockResolvedValue('OK'),
    mockRedisIncr: vi.fn().mockResolvedValue(1),
}));
vi.mock('../../src/lib/redis', () => ({
    redis: { set: mockRedisSet, incr: mockRedisIncr },
}));

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
import { notificationService, NOTIFICATION_TEMPLATES, classifyFcmResult, hashToken, PERMANENT_FCM_TOKEN_ERRORS, buildFcmMessage, resolveUrgentChannelId } from '../../src/services/notifications';
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
            expect(NOTIFICATION_TEMPLATES).toHaveProperty('new_lead');
        });

        it('should have new_lead template with senderName/phone placeholders', () => {
            const template = NOTIFICATION_TEMPLATES.new_lead;
            expect(template.titles.en).toBe('New Lead');
            expect(template.titles.ar).toBe('عميل محتمل جديد');
            expect(template.bodies.en).toContain('{senderName}');
            expect(template.bodies.en).toContain('{phone}');
            expect(template.bodies.ar).toContain('{senderName}');
            expect(template.bodies.ar).toContain('{phone}');
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
            expect(template.titles.en).toBe('Business Info Gap Detected');
            expect(template.titles.ar).toBe('فجوة في معلومات نشاطك التجاري');
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
        /** Wire db.insert(...).values(...).onConflictDoUpdate(...) and the prune. */
        function mockUpsert(onConflictResult: Promise<unknown> = Promise.resolve(undefined)) {
            const onConflictDoUpdate = vi.fn().mockReturnValue(onConflictResult);
            const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
            (db.insert as any).mockReturnValue({ values });
            const deleteWhere = vi.fn().mockResolvedValue(undefined);
            (db.delete as any).mockReturnValue({ where: deleteWhere });
            return { values, onConflictDoUpdate, deleteWhere };
        }

        it('registers in ONE statement — no read-then-write left to race', async () => {
            // The defect this replaced: SELECT → branch → INSERT, no transaction,
            // no unique constraint. Two concurrent registrations of the same token
            // both read zero rows and both inserted, so the device received every
            // push twice. Asserting the SELECT is GONE is the point here — a
            // re-introduced read restores the race without failing anything else.
            const { values, onConflictDoUpdate } = mockUpsert();

            await notificationService.registerDeviceToken('user-123', 'fcm-token-abc', 'android');

            expect(db.select).not.toHaveBeenCalled();
            expect(db.update).not.toHaveBeenCalled();
            expect(values).toHaveBeenCalledWith({
                userId: 'user-123', token: 'fcm-token-abc', platform: 'android',
            });
            expect(onConflictDoUpdate).toHaveBeenCalledTimes(1);
        });

        it('conflicts on (user_id, token) and bumps only lastUsedAt', async () => {
            // The conflict target must match the unique index from migration 0165.
            // Naming the wrong columns throws at runtime ("no unique or exclusion
            // constraint matching the ON CONFLICT specification") — a failure no
            // call-happened assertion can see, because the mock resolves anyway.
            const { onConflictDoUpdate } = mockUpsert();

            await notificationService.registerDeviceToken('user-123', 'fcm-token-abc', 'android');

            const arg = onConflictDoUpdate.mock.calls[0][0];
            expect(arg.target.map((col: { name: string }) => col.name)).toEqual(['user_id', 'token']);
            // platform is deliberately NOT refreshed: the token belongs to the
            // install that minted it, and the old read-then-write left it alone.
            expect(Object.keys(arg.set)).toEqual(['lastUsedAt']);
            expect(arg.set.lastUsedAt).toBeInstanceOf(Date);
        });

        it('prunes stale sibling tokens for the same user+platform on register', async () => {
            const { deleteWhere } = mockUpsert();

            await notificationService.registerDeviceToken('user-123', 'fcm-new', 'android');

            expect(db.delete).toHaveBeenCalled();
            expect(deleteWhere).toHaveBeenCalledTimes(1);
        });

        it('swallows the FK violation when the user row is gone but the JWT is not', async () => {
            const { deleteWhere } = mockUpsert(
                Promise.reject(Object.assign(new Error('violates foreign key constraint'), { code: '23503' })),
            );

            await expect(
                notificationService.registerDeviceToken('deleted-user', 'fcm-token-abc', 'android'),
            ).resolves.toBeUndefined();

            // Returns before the prune — there is no user left to prune for.
            expect(deleteWhere).not.toHaveBeenCalled();
        });

        it('rethrows any other database error rather than losing the token silently', async () => {
            mockUpsert(Promise.reject(Object.assign(new Error('deadlock detected'), { code: '40P01' })));

            await expect(
                notificationService.registerDeviceToken('user-123', 'fcm-token-abc', 'android'),
            ).rejects.toThrow('deadlock detected');
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
                    en: expect.stringContaining('Angry customer'),
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
            expect(payload.bodies.en).toContain('Angry customer');
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
            expect(payload.bodies.ar).toContain('يحتاج مراجعتك');
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
                { senderName: 'Customer', reason: 'cancellation_request — order #5678' },
            );

            const payload = sendNotificationSpy.mock.calls[0][1];
            expect(payload.bodies.ar).toContain('طلب إلغاء');
            expect(payload.bodies.ar).toContain('5678');
            expect(payload.bodies.en).toContain('Cancellation request — order #5678');
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
                ['cancellation_request', 'طلب إلغاء'],
                ['refund_request', 'طلب استرجاع'],
                ['exchange_request', 'طلب استبدال'],
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
            expect(payload.bodies.ar).toContain('تم تمييز هذا الرد للمراجعة');
            expect(payload.bodies.ar).not.toContain('AI flagged');
            // Project rule: never say "AI" / "ذكاء اصطناعي" in user-facing copy.
            expect(payload.bodies.ar).not.toContain('الذكاء الاصطناعي');
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

    // ── Push notification rate limiting ──────────────────────────────────────────
    // When hundreds of messages arrive at once (e.g. on first page connection),
    // only the first push per user+type is sent within the cooldown window.
    // Notifications are still stored in DB every time.

    describe('push rate limiting', () => {
        /** Sets up DB mocks so sendNotification reaches the Redis rate-limit check */
        function setupWithDeviceTokens() {
            // insert notification → returning [{ id }]
            (db.insert as any).mockReturnValue({
                values: vi.fn().mockReturnValue({
                    returning: vi.fn().mockResolvedValue([{ id: 'notif-123' }]),
                }),
            });
            // getUserDeviceTokens → one token
            (db.select as any).mockReturnValueOnce({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([{ token: 'fcm-token-1' }]),
                }),
            });
            // getUserLanguage → 'en'
            (db.select as any).mockReturnValueOnce({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([{ dashboardLanguage: 'en' }]),
                    }),
                }),
            });
        }

        beforeEach(() => {
            mockRedisSet.mockReset();
            mockRedisSet.mockResolvedValue('OK');
            mockRedisIncr.mockReset();
            mockRedisIncr.mockResolvedValue(1);
        });

        it('should call redis.set with NX for rate-limited notification types', async () => {
            setupWithDeviceTokens();

            await notificationService.sendNotification('user-1', {
                type: 'flagged_reply',
                titles: { en: 'Test', ar: 'اختبار' },
                bodies: { en: 'Body', ar: 'نص' },
            });

            expect(mockRedisSet).toHaveBeenCalledWith(
                'notif:push:rl:user-1:flagged_reply',
                '1',
                'EX',
                300,
                'NX',
            );
        });

        it('should NOT call redis.set for non-rate-limited types (payment_failed)', async () => {
            setupWithDeviceTokens();

            await notificationService.sendNotification('user-1', {
                type: 'payment_failed',
                titles: { en: 'Payment Failed', ar: 'فشل الدفع' },
                bodies: { en: 'Please update', ar: 'يرجى التحديث' },
            });

            expect(mockRedisSet).not.toHaveBeenCalled();
        });

        it('should skip push when redis.set returns null (rate limited)', async () => {
            // null means the key already existed — cooldown active
            mockRedisSet.mockResolvedValue(null);
            setupWithDeviceTokens();

            // We verify FCM is not attempted by checking firebase-admin is never required.
            // Since FIREBASE_SERVICE_ACCOUNT_KEY is not set in tests, sendPushNotification
            // would log a warning and return. The key assertion is that redis.set was called
            // and returned null, which is what prevents the push.
            const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

            await notificationService.sendNotification('user-1', {
                type: 'skipped_reply',
                titles: { en: 'Skipped', ar: 'تم التخطي' },
                bodies: { en: 'Body', ar: 'نص' },
            });

            // redis.set was called and returned null (rate limited) — no FCM warning
            expect(mockRedisSet).toHaveBeenCalledTimes(1);
            expect(consoleSpy).not.toHaveBeenCalledWith(
                expect.stringContaining('FCM not configured'),
            );

            consoleSpy.mockRestore();
        });

        it('should still insert the notification in DB even when push is rate-limited', async () => {
            mockRedisSet.mockResolvedValue(null); // rate limited
            setupWithDeviceTokens();

            await notificationService.sendNotification('user-1', {
                type: 'flagged_reply',
                titles: { en: 'Test', ar: 'اختبار' },
                bodies: { en: 'Body', ar: 'نص' },
            });

            // DB insert must always happen regardless of push rate limit
            expect(db.insert).toHaveBeenCalled();
        });

        it('should use separate rate-limit keys per user', async () => {
            setupWithDeviceTokens();
            await notificationService.sendNotification('user-A', {
                type: 'flagged_reply',
                titles: { en: 'T', ar: 'ت' },
                bodies: { en: 'B', ar: 'ب' },
            });

            expect(mockRedisSet).toHaveBeenCalledWith(
                'notif:push:rl:user-A:flagged_reply',
                expect.any(String),
                expect.any(String),
                expect.any(Number),
                'NX',
            );
        });

        it('suppresses the push but still stores the bell row when pushEnabled is false', async () => {
            setupWithDeviceTokens();

            await notificationService.sendNotification(
                'user-1',
                {
                    type: 'new_lead',
                    titles: { en: 'New Lead', ar: 'عميل محتمل جديد' },
                    bodies: { en: 'Body', ar: 'نص' },
                },
                { pushEnabled: false },
            );

            // Bell row is always persisted...
            expect(db.insert).toHaveBeenCalled();
            // ...but the entire push block (cooldown check + FCM send) is skipped.
            expect(mockRedisSet).not.toHaveBeenCalled();
        });

        it('urgent pushes use a separate key + short (60s) cooldown so distinct bad comments still alert', async () => {
            setupWithDeviceTokens();

            await notificationService.sendNotification('user-1', {
                type: 'skipped_reply',
                titles: { en: 'Offensive', ar: 'مسيء' },
                bodies: { en: 'Body', ar: 'نص' },
                data: { urgent: true },
            });

            expect(mockRedisSet).toHaveBeenCalledWith(
                'notif:push:rl:user-1:skipped_reply:urgent',
                '1',
                'EX',
                60,
                'NX',
            );
        });
    });

    // Per-user push gating inside the workspace fan-out. Used by new-lead
    // alerts: every member gets the in-app bell row, but the push is suppressed
    // for members who turned `newLeadAlertsEnabled` off.
    describe('sendNotificationToWorkspace push gating', () => {
        it('resolves pushEnabled per member from the setting (absent → true)', async () => {
            // 1. workspace members query
            (db.select as any).mockReturnValueOnce({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([
                        { userId: 'u-on' },
                        { userId: 'u-off' },
                        { userId: 'u-absent' },
                    ]),
                }),
            });
            // 2. batched settings preference query (u-absent has no row)
            (db.select as any).mockReturnValueOnce({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([
                        { userId: 'u-on', enabled: true },
                        { userId: 'u-off', enabled: false },
                    ]),
                }),
            });

            const spy = vi.spyOn(notificationService, 'sendNotification').mockResolvedValue('notif-x');

            await notificationService.sendTemplateNotificationToWorkspace(
                'ws-1',
                'new_lead',
                { senderName: 'Ali', phone: '+9647701234567' },
                { leadId: 'l-1', pageId: 'p-1', deepLink: '/leads' },
                { gatePushBySetting: 'newLeadAlertsEnabled' },
            );

            expect(spy).toHaveBeenCalledWith('u-on', expect.objectContaining({ type: 'new_lead' }), { pushEnabled: true });
            expect(spy).toHaveBeenCalledWith('u-off', expect.objectContaining({ type: 'new_lead' }), { pushEnabled: false });
            // No settings row → defaults to enabled.
            expect(spy).toHaveBeenCalledWith('u-absent', expect.objectContaining({ type: 'new_lead' }), { pushEnabled: true });
        });

        it('does not gate push (and runs no preference query) when no options are passed', async () => {
            // Only the workspace members query runs — no settings preference query.
            (db.select as any).mockReturnValueOnce({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([{ userId: 'u-1' }]),
                }),
            });

            const spy = vi.spyOn(notificationService, 'sendNotification').mockResolvedValue('notif-y');

            await notificationService.sendTemplateNotificationToWorkspace(
                'ws-1',
                'new_comment',
                { senderName: 'Ali' },
            );

            expect(spy).toHaveBeenCalledWith('u-1', expect.objectContaining({ type: 'new_comment' }), { pushEnabled: undefined });
            // Members query only — the preference select was never issued.
            expect(db.select).toHaveBeenCalledTimes(1);
        });
    });

    // FCM error-code classification — drives the "delete vs keep" decision in
    // the send path. The previous implementation deleted tokens on ANY failure,
    // silently mass-evicting live tokens during FCM brownouts. This contract
    // locks in the fix.
    describe('classifyFcmResult', () => {
        it('returns success for a successful send', () => {
            expect(classifyFcmResult(true, undefined)).toBe('success');
        });

        it('returns permanent_failure for NotRegistered', () => {
            expect(classifyFcmResult(false, 'messaging/registration-token-not-registered')).toBe('permanent_failure');
        });

        it('returns permanent_failure for InvalidRegistrationToken', () => {
            expect(classifyFcmResult(false, 'messaging/invalid-registration-token')).toBe('permanent_failure');
        });

        it('returns permanent_failure for InvalidArgument', () => {
            expect(classifyFcmResult(false, 'messaging/invalid-argument')).toBe('permanent_failure');
        });

        it('returns transient_failure for FCM internal-error (server brownout)', () => {
            expect(classifyFcmResult(false, 'messaging/internal-error')).toBe('transient_failure');
        });

        it('returns transient_failure for server-unavailable', () => {
            expect(classifyFcmResult(false, 'messaging/server-unavailable')).toBe('transient_failure');
        });

        it('returns transient_failure for quota-exceeded', () => {
            expect(classifyFcmResult(false, 'messaging/quota-exceeded')).toBe('transient_failure');
        });

        it('returns transient_failure when errorCode is missing (network drop, malformed response)', () => {
            expect(classifyFcmResult(false, undefined)).toBe('transient_failure');
        });

        it('returns transient_failure for unknown error codes (default-keep policy)', () => {
            // Critical: any unknown / future error code must be classified as
            // transient so we don't accidentally delete live tokens on a code
            // we haven't seen before.
            expect(classifyFcmResult(false, 'messaging/some-future-error-we-have-not-seen')).toBe('transient_failure');
        });

        it('PERMANENT_FCM_TOKEN_ERRORS contains exactly the three token-killing codes', () => {
            // Locks the set so accidental additions during refactoring are caught.
            expect(PERMANENT_FCM_TOKEN_ERRORS.size).toBe(3);
            expect(PERMANENT_FCM_TOKEN_ERRORS.has('messaging/registration-token-not-registered')).toBe(true);
            expect(PERMANENT_FCM_TOKEN_ERRORS.has('messaging/invalid-registration-token')).toBe(true);
            expect(PERMANENT_FCM_TOKEN_ERRORS.has('messaging/invalid-argument')).toBe(true);
        });
    });

    // Token hashing for the audit log — raw FCM tokens must never land in
    // notification_send_log. Hashing must be deterministic so we can look up
    // a customer's token by hashing what they report.
    describe('hashToken', () => {
        it('produces a 64-char hex SHA-256 hash', () => {
            const hash = hashToken('fcm-some-token-value');
            expect(hash).toMatch(/^[0-9a-f]{64}$/);
        });

        it('is deterministic — same input produces same hash', () => {
            const a = hashToken('the-same-token');
            const b = hashToken('the-same-token');
            expect(a).toBe(b);
        });

        it('produces different hashes for different inputs', () => {
            expect(hashToken('token-a')).not.toBe(hashToken('token-b'));
        });

        it('does not contain the original token', () => {
            const token = 'sensitive-fcm-token-do-not-leak';
            const hash = hashToken(token);
            expect(hash).not.toContain(token);
        });
    });

    describe('buildFcmMessage', () => {
        const base = {
            type: 'skipped_reply' as const,
            titles: { en: 'Title EN', ar: 'Title AR' },
            bodies: { en: 'Body EN', ar: 'Body AR' },
        };

        it('routes urgent pushes to the urgent channel + high priority + custom iOS sound', () => {
            const msg = buildFcmMessage(
                { ...base, data: { commentId: 'c1', urgent: true } },
                'en',
                ['tok-1'],
            ) as any;

            expect(msg.android.priority).toBe('high');
            expect(msg.android.notification.channelId).toBe('jawab24_urgent'); // default until ANDROID_URGENT_SOUND flips to v2
            expect(msg.apns.headers['apns-priority']).toBe('10');
            expect(msg.apns.payload.aps.sound).toBe('urgent_alert.caf');
        });

        it('routes routine pushes to the quiet default channel with no custom sound', () => {
            const msg = buildFcmMessage(
                { ...base, type: 'new_comment', data: { commentId: 'c1' } },
                'en',
                ['tok-1'],
            ) as any;

            expect(msg.android.priority).toBe('normal');
            expect(msg.android.notification.channelId).toBe('jawab24_default');
            expect(msg.apns).toBeUndefined();
        });

        it('resolves title/body for the user language, falling back to English', () => {
            const ar = buildFcmMessage({ ...base, data: { urgent: true } }, 'ar', ['t']) as any;
            expect(ar.notification.title).toBe('Title AR');

            const fr = buildFcmMessage({ ...base, data: { urgent: true } }, 'fr', ['t']) as any;
            expect(fr.notification.title).toBe('Title EN'); // no fr → English fallback
        });
    });

    describe('resolveUrgentChannelId', () => {
        it('returns the legacy channel when custom sound is off (default/safe)', () => {
            expect(resolveUrgentChannelId(false)).toBe('jawab24_urgent');
        });

        it('returns the v2 custom-sound channel when enabled', () => {
            expect(resolveUrgentChannelId(true)).toBe('jawab24_urgent_v2');
        });
    });
});
