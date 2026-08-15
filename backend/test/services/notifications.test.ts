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
import { notificationService, NOTIFICATION_TEMPLATES, classifyFcmResult, hashToken, PERMANENT_FCM_TOKEN_ERRORS, buildFcmMessage, buildNotificationTag, buildTemplatePayload, resolveUrgentChannelId, type NotificationType } from '../../src/services/notifications';
import { flagReasonAr, flagReasonEn } from '@jawab24/shared';
import { db } from '../../src/db';

/**
 * What each notification type actually sends, copied from its production call
 * site — NOT synthesised. `buildFcmMessage` is shared infrastructure that every
 * push in the system passes through, so its guard has to assert against the
 * real payload shapes; a hand-made `data: {}` asserts nothing.
 *
 * `source` is the call site, so a reader can re-verify a row without grepping.
 * `tag` is what buildNotificationTag must therefore emit — `undefined` means the
 * push still STACKS, which is the correct answer for anything that does not name
 * a single row.
 *
 * Typed Record<NotificationType, …> on purpose: adding a notification type
 * surfaces here immediately in the editor. It does NOT fail `npm run type-check`
 * — backend/tsconfig.json includes the src tree only, so no tsc run ever sees
 * this file — which is why the `covers every notification type in the registry`
 * case below repeats the check at RUNTIME. That one is the real gate.
 */
interface ProductionPayloadSpec {
    source: string;
    data?: Record<string, unknown>;
    tag?: string;
}

const PRODUCTION_PAYLOADS: Record<NotificationType, ProductionPayloadSpec> = {
    // ---- Row-targeted: these collapse, and that is the point of the change ----
    flagged_reply: {
        source: 'services/reply/messageProcessor.ts:1005',
        data: { messageId: 'm1', type: 'message', deepLink: '/messages?filter=flagged' },
        tag: 'flagged_reply:m1',
    },
    skipped_reply: {
        source: 'services/reply/commentProcessor.ts:698',
        data: { commentId: 'c1', type: 'comment', deepLink: '/comments?filter=flagged', urgent: true },
        tag: 'skipped_reply:c1',
    },
    new_comment: {
        source: 'services/reply/commentProcessor.ts:775',
        data: { commentId: 'c1', type: 'comment', deepLink: '/comments?filter=flagged' },
        tag: 'new_comment:c1',
    },
    stale_comment: {
        source: 'services/escalation.ts:279',
        data: { commentId: 'c1' },
        tag: 'stale_comment:c1',
    },
    stale_message: {
        source: 'services/escalation.ts:361',
        data: { type: 'message', messageId: 'm1', senderId: 's1', pageId: 'p1' },
        tag: 'stale_message:m1',
    },
    new_lead: {
        source: 'services/leadExtractor.ts:625',
        data: { leadId: 'l1', pageId: 'p1', deepLink: '/leads?leadId=l1' },
        tag: 'new_lead:l1',
    },
    lead_reengaged: {
        source: 'services/leadExtractor.ts:683',
        data: { leadId: 'l1', pageId: 'p1', deepLink: '/leads?leadId=l1', urgent: true },
        tag: 'lead_reengaged:l1',
    },

    // ---- Page-scoped: a page emits MANY distinct events, so these must stack ----
    kb_gap: {
        source: 'services/kb/gap-detector.ts:196 — one per missing topic',
        data: { pageId: 'p1', intent: 'price', occurrenceCount: 3, sampleQuery: 'كم السعر؟', deepLink: '/pages#page-p1' },
    },
    auto_reply_paused: {
        source: 'services/pageAutoPause.ts:203',
        data: { pageId: 'p1', action: 'reconnect_page', urgent: true },
    },
    post_reply_orphaned: {
        source: 'services/posts.ts:734 — one per detection, different post ids',
        data: { pageId: 'p1', orphanedPostIds: ['post-1'] },
    },

    // ---- Id-less: nothing to collapse on ----
    payment_failed: { source: 'controllers/paymentWebhookHandlers.ts:502', data: { deepLink: '/settings' } },
    refund_processed: { source: 'controllers/paymentWebhookHandlers.ts:656', data: { deepLink: '/settings' } },
    topup_credited: { source: 'controllers/paymentWebhookHandlers.ts:504', data: { deepLink: '/dashboard' } },
    page_disconnected: { source: 'services/tokenRefresh.ts:275', data: { action: 'reconnect_page' } },
    whatsapp_reconnect_needed: { source: 'services/whatsappTokenHealth.ts:311', data: { action: 'reconnect_whatsapp' } },
    whatsapp_token_expiring: { source: 'services/whatsappTokenHealth.ts:340', data: { action: 'reconnect_whatsapp' } },
    // `pageId` is deliberately NOT a target key (packages/shared/src/notifications.ts),
    // so this stacks rather than collapsing — correct: a merchant with two dead
    // Instagram cards must see both.
    instagram_reconnect_needed: { source: 'services/instagramLogin.ts:369', data: { action: 'reconnect_instagram', pageId: 'p1' } },
    provider_failover: { source: 'services/ai.ts:947', data: { urgent: true } },
    page_trial_used: { source: 'controllers/pages.ts:541 — no data argument' },
    trial_ending: { source: 'services/trialReminders.ts:267 — no data argument' },
    trial_ended: { source: 'services/trialReminders.ts:318 — no data argument' },
    image_limit_reached: { source: 'services/imageUnderstanding.ts:524 — no data argument' },
    auto_reply_paused_billing: { source: 'services/subscriptions.ts:1127 — no data argument' },
    ai_usage_warning_80: { source: 'services/subscriptions.ts:774 — no data argument' },
    ai_usage_limit_reached: { source: 'services/subscriptions.ts:774 — no data argument' },
    ai_usage_on_topup: { source: 'services/subscriptions.ts:774 — no data argument' },
    ai_usage_topup_low: { source: 'services/subscriptions.ts:774 — no data argument' },
    // Templates with no production sender today (demo seeder only). Recorded so
    // the exhaustiveness check stays honest rather than being weakened for them.
    subscription_expiring: { source: 'no live sender — plugins/demo/seedData.ts:1897 only' },
    subscription_renewed: { source: 'no live sender — plugins/demo/seedData.ts:1913 only' },
};

const PRODUCTION_PAYLOAD_ENTRIES = Object.entries(PRODUCTION_PAYLOADS) as Array<[NotificationType, ProductionPayloadSpec]>;

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

        it('suppressPush mutes EVERY member regardless of their per-user setting (info reply mode, D-083)', async () => {
            // 1. workspace members query
            (db.select as any).mockReturnValueOnce({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([
                        { userId: 'u-on' },
                        { userId: 'u-off' },
                    ]),
                }),
            });
            // 2. batched settings preference query — u-on has alerts ENABLED, yet
            //    the page-level info mode must still win.
            (db.select as any).mockReturnValueOnce({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([
                        { userId: 'u-on', enabled: true },
                        { userId: 'u-off', enabled: false },
                    ]),
                }),
            });

            const spy = vi.spyOn(notificationService, 'sendNotification').mockResolvedValue('notif-z');

            await notificationService.sendTemplateNotificationToWorkspace(
                'ws-1',
                'new_lead',
                { senderName: 'Ali', phone: '+9647701234567' },
                { leadId: 'l-1', pageId: 'p-1', deepLink: '/leads' },
                { gatePushBySetting: 'newLeadAlertsEnabled', suppressPush: true },
            );

            // Bell rows still store for everyone (sendNotification is still called),
            // but push is off for ALL members — including the alerts-enabled one.
            expect(spy).toHaveBeenCalledWith('u-on', expect.objectContaining({ type: 'new_lead' }), { pushEnabled: false });
            expect(spy).toHaveBeenCalledWith('u-off', expect.objectContaining({ type: 'new_lead' }), { pushEnabled: false });
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

        it('stamps the android tag so a duplicate delivery replaces rather than stacks', () => {
            // The reported bug: one multicast, two live tokens on ONE device → the
            // same push rendered twice. Identical payload ⇒ identical tag ⇒ Android
            // replaces the first tray entry instead of adding a second.
            const first = buildFcmMessage(
                { ...base, type: 'flagged_reply', data: { messageId: 'm1', type: 'message' } },
                'ar', ['tok-a'],
            ) as any;
            const second = buildFcmMessage(
                { ...base, type: 'flagged_reply', data: { messageId: 'm1', type: 'message' } },
                'ar', ['tok-b'],
            ) as any;

            expect(first.android.notification.tag).toBe('flagged_reply:m1');
            expect(second.android.notification.tag).toBe(first.android.notification.tag);
        });

        it('keeps distinct targets on distinct tags so they still stack', () => {
            const m1 = buildFcmMessage({ ...base, type: 'flagged_reply', data: { messageId: 'm1' } }, 'en', ['t']) as any;
            const m2 = buildFcmMessage({ ...base, type: 'flagged_reply', data: { messageId: 'm2' } }, 'en', ['t']) as any;
            expect(m1.android.notification.tag).not.toBe(m2.android.notification.tag);
        });

        it('separates the same row across notification types', () => {
            const flagged = buildFcmMessage({ ...base, type: 'flagged_reply', data: { commentId: 'c1' } }, 'en', ['t']) as any;
            const skipped = buildFcmMessage({ ...base, type: 'skipped_reply', data: { commentId: 'c1' } }, 'en', ['t']) as any;
            expect(flagged.android.notification.tag).toBe('flagged_reply:c1');
            expect(skipped.android.notification.tag).toBe('skipped_reply:c1');
        });

        it('gives every lead its own tag (new_lead must never collapse)', () => {
            // NON_GROUPABLE_TYPES: the per-lead body carries name + phone, so two
            // leads collapsing into one tray entry would hide a real lead.
            const a = buildFcmMessage({ ...base, type: 'new_lead', data: { leadId: 'l1' } }, 'en', ['t']) as any;
            const b = buildFcmMessage({ ...base, type: 'new_lead', data: { leadId: 'l2' } }, 'en', ['t']) as any;
            expect(a.android.notification.tag).toBe('new_lead:l1');
            expect(b.android.notification.tag).toBe('new_lead:l2');
        });

        it('leaves channelId and priority untouched when a tag is added', () => {
            const msg = buildFcmMessage(
                { ...base, type: 'flagged_reply', data: { messageId: 'm1', urgent: true } },
                'en', ['t'],
            ) as any;
            expect(msg.android.priority).toBe('high');
            expect(msg.android.notification.channelId).toBe('jawab24_urgent');
            expect(msg.android.notification.tag).toBe('flagged_reply:m1');
        });

        it('emits exactly the tag each type\'s REAL payload earns', () => {
            // Shared-infrastructure guard: buildFcmMessage serves every type in
            // the system, so this asserts over the real `data` each one sends —
            // copied from its call site, not synthesised. An earlier version of
            // this test passed `data: {}` to every type; that made it a
            // tautology, and it was blind to the three page-scoped types whose
            // production payloads DO carry an id.
            for (const [type, spec] of PRODUCTION_PAYLOAD_ENTRIES) {
                const msg = buildFcmMessage({ ...base, type, data: spec.data }, 'en', ['t']) as any;
                expect(msg.android.notification.tag, `${type} — ${spec.source}`).toBe(spec.tag);
            }
        });

        it('covers every notification type in the registry', () => {
            // The real gate. PRODUCTION_PAYLOADS' Record<NotificationType, …>
            // type only helps in the editor — backend/tsconfig.json includes the
            // src tree only, so no tsc run ever sees this file. Comparing the two
            // key sets at runtime is what actually stops a new notification type
            // from shipping without a recorded collapse decision, and it catches
            // drift in both directions.
            expect(Object.keys(PRODUCTION_PAYLOADS).sort())
                .toEqual(Object.keys(NOTIFICATION_TEMPLATES).sort());
        });

        it('routes each real payload to the channel its own urgency demands', () => {
            // The old guard asserted 'jawab24_default' for every "id-less" type
            // while feeding them `data: {}`. auto_reply_paused really sends
            // `urgent: true`, so that assertion was wrong about production too.
            for (const [type, spec] of PRODUCTION_PAYLOAD_ENTRIES) {
                const msg = buildFcmMessage({ ...base, type, data: spec.data }, 'en', ['t']) as any;
                const expected = spec.data?.urgent === true ? 'jawab24_urgent' : 'jawab24_default';
                expect(msg.android.notification.channelId, `${type} — ${spec.source}`).toBe(expected);
            }
        });

        it('never collapses a page-scoped alert (regression: kb_gap lost distinct topics)', () => {
            // A page is a container, not a target. Two different missing-info
            // topics on ONE page are distinct events; tagging by pageId made the
            // second silently replace the first in the tray.
            const first = buildFcmMessage(
                { ...base, type: 'kb_gap', data: { pageId: 'p1', intent: 'delivery', sampleQuery: 'هل توصلون لحلب؟' } },
                'ar', ['t'],
            ) as any;
            const second = buildFcmMessage(
                { ...base, type: 'kb_gap', data: { pageId: 'p1', intent: 'price', sampleQuery: 'كم السعر؟' } },
                'ar', ['t'],
            ) as any;
            expect(first.android.notification.tag).toBeUndefined();
            expect(second.android.notification.tag).toBeUndefined();
        });
    });

    describe('buildNotificationTag', () => {
        const base = {
            titles: { en: 'T' },
            bodies: { en: 'B' },
        };

        it('returns undefined when the payload names no target', () => {
            expect(buildNotificationTag({ ...base, type: 'payment_failed' })).toBeUndefined();
            expect(buildNotificationTag({ ...base, type: 'payment_failed', data: {} })).toBeUndefined();
            expect(buildNotificationTag({ ...base, type: 'payment_failed', data: { urgent: true } })).toBeUndefined();
        });

        it('tags on the row id, ignoring any pageId alongside it', () => {
            // The deep-link fix will add pageId to these payloads. The ROW stays
            // the target: two flagged rows on one page must not collapse into a
            // single tray entry.
            expect(buildNotificationTag({
                ...base, type: 'flagged_reply', data: { pageId: 'p1', messageId: 'm1' },
            })).toBe('flagged_reply:m1');
            expect(buildNotificationTag({
                ...base, type: 'flagged_reply', data: { pageId: 'p1', commentId: 'c1' },
            })).toBe('flagged_reply:c1');
        });

        it('never tags on pageId alone — a page is a container, not a target', () => {
            // Regression: pageId used to be the last resort in the key list, so
            // every kb_gap on a page shared one tag and each new missing-info
            // topic silently replaced the previous one in the tray.
            expect(buildNotificationTag({ ...base, type: 'kb_gap', data: { pageId: 'p1' } })).toBeUndefined();
            expect(buildNotificationTag({ ...base, type: 'auto_reply_paused', data: { pageId: 'p1', urgent: true } })).toBeUndefined();
            expect(buildNotificationTag({ ...base, type: 'post_reply_orphaned', data: { pageId: 'p1', orphanedPostIds: ['x'] } })).toBeUndefined();
        });

        it('ignores non-string and empty ids', () => {
            expect(buildNotificationTag({ ...base, type: 'flagged_reply', data: { messageId: '' } })).toBeUndefined();
            expect(buildNotificationTag({ ...base, type: 'flagged_reply', data: { messageId: 42 } })).toBeUndefined();
            expect(buildNotificationTag({ ...base, type: 'flagged_reply', data: { messageId: null } })).toBeUndefined();
        });
    });

    describe('flag reasons in the push body', () => {
        // packages/shared/src/i18n/*/flagReason.json feeds TWO surfaces: the inbox
        // chip (FlagTag) and the flagged_reply push body (translateFlagReason).
        // Only the chip was ever asserted, which is how `ارجو` shipped for three
        // keys. The VALUES are pinned in packages/shared (flagReasonArabic.test.ts);
        // what these cases pin is the plumbing — that the shared map reaches the
        // body at all, and that a raw flag code never reaches a merchant's phone.
        const KB_GAP_REASONS = ['price_not_in_kb', 'info_not_in_kb', 'phone_not_in_kb'] as const;

        it('renders the shared Arabic label into the Arabic push body', () => {
            for (const reason of KB_GAP_REASONS) {
                const payload = buildTemplatePayload(
                    'flagged_reply',
                    { senderName: 'Ali', reason },
                    { messageId: 'm1', type: 'message' },
                );
                expect(payload.bodies.ar, `${reason} not translated into the AR body`)
                    .toContain((flagReasonAr as Record<string, string>)[reason]);
                expect(payload.bodies.ar, `raw flag code leaked into the AR body`).not.toContain(reason);
            }
        });

        // The channel-reconnect notices exist to make a merchant ACT, and they can
        // only be acted on if the copy names the number/account that died. The
        // sweeps assert their half (that they pass `{number}`); this asserts the
        // other half against the REAL templates — drop the placeholder from either
        // locale and the merchant gets a notice about an unnamed channel.
        it('whatsapp templates render the number', () => {
            const reconnect = buildTemplatePayload('whatsapp_reconnect_needed', { number: '+966 55 000 0000' });
            expect(reconnect.bodies.en).toContain('+966 55 000 0000');
            expect(reconnect.bodies.ar).toContain('+966 55 000 0000');

            const expiring = buildTemplatePayload('whatsapp_token_expiring', { number: '+966 55 000 0000', days: '3' });
            expect(expiring.bodies.en).toContain('+966 55 000 0000');
            expect(expiring.bodies.ar).toContain('+966 55 000 0000');
            expect(expiring.bodies.en).toContain('3');
            expect(expiring.bodies.ar).toContain('3');
        });

        it('instagram reconnect template renders the account handle', () => {
            const payload = buildTemplatePayload('instagram_reconnect_needed', { account: '@shop' });
            expect(payload.bodies.en).toContain('@shop');
            expect(payload.bodies.ar).toContain('@shop');
            expect(payload.bodies.en).not.toContain('{account}');
            expect(payload.bodies.ar).not.toContain('{account}');
        });

        it('renders the shared English label into the English push body', () => {
            for (const reason of KB_GAP_REASONS) {
                const payload = buildTemplatePayload(
                    'flagged_reply',
                    { senderName: 'Ali', reason },
                    { commentId: 'c1', type: 'comment' },
                );
                expect(payload.bodies.en).toContain((flagReasonEn as Record<string, string>)[reason]);
                expect(payload.bodies.en).not.toContain(reason);
            }
        });

        it('carries the label all the way into the FCM message the device receives', () => {
            // buildTemplatePayload → buildFcmMessage is the whole push path; assert
            // its END, not just the middle.
            const msg = buildFcmMessage(
                buildTemplatePayload('flagged_reply', { senderName: 'Ali', reason: 'price_not_in_kb' }, { messageId: 'm1' }),
                'ar',
                ['tok'],
            ) as any;
            expect(msg.notification.body).toContain((flagReasonAr as Record<string, string>).price_not_in_kb);
            expect(msg.android.notification.tag).toBe('flagged_reply:m1');
        });
    });

    describe('apns-collapse-id budget (iOS follow-up)', () => {
        it('every possible tag fits in the 64-byte APNs cap', () => {
            // The follow-up will set apns-collapse-id to this same tag. APNs rejects
            // above 64 bytes and the failure shows up as an error row in
            // notification_send_log, never as a compile error — so pin it now, while
            // the headroom is only two bytes. A longer type name fails HERE instead.
            const APNS_COLLAPSE_ID_MAX_BYTES = 64;
            const UUID_LENGTH = 36;
            const longest = Object.keys(NOTIFICATION_TEMPLATES)
                .reduce((a, b) => (b.length > a.length ? b : a));
            const worstCase = Buffer.byteLength(`${longest}:${'x'.repeat(UUID_LENGTH)}`, 'utf8');
            expect(worstCase, `type "${longest}" would overrun the APNs collapse-id cap`)
                .toBeLessThanOrEqual(APNS_COLLAPSE_ID_MAX_BYTES);
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
