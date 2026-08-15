import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The partner merchant-detail projection is a security boundary, not a
 * formatting step: it decides what an EXTERNAL reseller may read about a
 * merchant who is not their own account. These tests pin the two rules that
 * make it safe — the ownership gate, and "configured-or-not, never content".
 */

const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(),
};

vi.mock('../../src/db', () => ({ db: { select: vi.fn(() => selectChain), update: vi.fn() } }));
vi.mock('../../src/db/schema', () => ({
    partners: { id: 'id', email: 'email', userId: 'user_id', isActive: 'is_active' },
    users: { id: 'id', partnerId: 'partner_id', partnerNote: 'partner_note', name: 'name', phone: 'phone' },
    subscriptions: {}, plans: {}, pages: { userId: 'user_id', id: 'id', name: 'name' },
}));
vi.mock('drizzle-orm', () => ({
    and: vi.fn(), desc: vi.fn(), eq: vi.fn(), inArray: vi.fn(),
    sql: Object.assign(vi.fn(), { join: vi.fn(), raw: vi.fn() }),
}));
vi.mock('../../src/services/admin/users', () => ({
    adminUsersService: { getUserDetail: vi.fn() },
}));

import { partnerPortalService } from '../../src/services/partnerPortal';
import { adminUsersService } from '../../src/services/admin/users';

/** A full admin payload, including every field a partner must NOT receive. */
function adminDetailFixture() {
    return {
        id: 'merchant-1',
        name: 'حلويات قصر الشام',
        email: 'merchant@example.com',              // must never reach a partner
        phone: '+963944123456',
        facebookId: 'fb-123',                        // must never reach a partner
        createdAt: new Date('2026-08-13'),
        lastSeenAt: new Date('2026-08-15'),
        topupBalance: 250,
        aiModel: 'gpt-4.1',                          // must never reach a partner
        subscription: {
            id: 'sub-1', status: 'trialing', planName: 'Starter', planSlug: 'starter',
            trialEndsAt: new Date('2026-08-10'),     // already lapsed
            currentPeriodEnd: new Date('2026-08-10'),
            maxAiRepliesPerMonth: 200, maxPages: 1, paymentMethod: null,
            currentPeriodStart: new Date('2026-08-03'), planId: 'plan-1',
        },
        settings: {
            values: {
                aiEnabled: true,
                commentsAutoReply: false,
                messagesAutoReply: true,
                greetingMessageEnabled: true,
                businessHoursOnly: false,
                replyStyle: 'friendly',
                // Merchant-authored content — must collapse to booleans.
                brandVoiceNotes: 'تحدث بلهجة شامية ودودة واذكر أن التوصيل مجاني',
                brandVoiceNotesMulti: { ar: 'نص الشخصية' },
                greetingMessageMulti: { ar: 'أهلاً وسهلاً بك في حلويات قصر الشام' },
                awayMessageMulti: {},
            },
            nonDefaultKeys: ['aiEnabled'],
            source: 'effective' as const,
        },
        usage: { aiRepliesCount: 12, postRepliesCount: 3, periodStart: null, periodEnd: null, limit: 200 },
        leads: { total: 4, today: 1, last7d: 2, last30d: 4, byStatus: { new: 3, contacted: 1, converted: 0 } },
        health: [{ id: 'kb_empty', level: 'red' }],
        pages: [{
            id: 'page-1', name: 'حلويات قصر الشام دمشق', facebookPageId: 'fb-page-1',
            instagramUsername: null, instagramAccountId: 'ig-1',
            whatsappPhoneNumberId: null, whatsappDisplayPhoneNumber: null,
            whatsappAutoReplyEnabled: false, whatsappCoexistence: false, whatsappDisconnectReason: null,
            autoReplyEnabled: true, autoReplyDisabledReason: null,
            disconnected: false, disconnectReason: null, archivedAt: null,
            kb: { kbLength: 2995, kbActiveVersion: 3, kbUpdatedAt: new Date('2026-08-12'), chunksTotal: 20, chunksByType: {}, unresolvedGaps: 3 },
        }],
        workspaces: [{
            id: 'ws-1', name: 'قصر الشام', role: 'owner' as const, ownerId: 'merchant-1',
            ownerName: 'صاحب المحل',
            ownerEmail: 'owner@example.com',          // must never reach a partner
            isOwner: true, memberCount: 2,
        }],
    };
}

describe('partnerPortalService.getMerchantDetail', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        selectChain.from.mockReturnThis();
        selectChain.where.mockReturnThis();
    });

    it('returns null when the merchant is not attributed to this partner', async () => {
        selectChain.limit.mockResolvedValue([]);   // ownership gate finds nothing

        const result = await partnerPortalService.getMerchantDetail('partner-1', 'merchant-1');

        expect(result).toBeNull();
        // The gate must short-circuit BEFORE any merchant data is fetched.
        expect(adminUsersService.getUserDetail).not.toHaveBeenCalled();
    });

    describe('when the merchant IS attributed to the partner', () => {
        beforeEach(() => {
            selectChain.limit.mockResolvedValue([{ id: 'merchant-1', partnerNote: 'اتصل به قبل الخميس' }]);
            vi.mocked(adminUsersService.getUserDetail).mockResolvedValue(adminDetailFixture() as never);
        });

        it('never exposes the merchant email, facebook id, or AI model', async () => {
            const result = await partnerPortalService.getMerchantDetail('partner-1', 'merchant-1');

            expect(result).not.toBeNull();
            expect(result).not.toHaveProperty('email');
            expect(result).not.toHaveProperty('facebookId');
            expect(result).not.toHaveProperty('aiModel');
            // A deep scan catches a leak nested anywhere in the payload.
            const serialized = JSON.stringify(result);
            expect(serialized).not.toContain('merchant@example.com');
            expect(serialized).not.toContain('owner@example.com');
        });

        it('collapses merchant-authored text to booleans, never shipping the wording', async () => {
            const result = await partnerPortalService.getMerchantDetail('partner-1', 'merchant-1');

            expect(result!.settings).toMatchObject({
                aiEnabled: true,
                commentsAutoReply: false,
                hasBrandVoice: true,
                hasGreetingMessage: true,
                hasAwayMessage: false,        // empty object → not configured
            });
            const serialized = JSON.stringify(result);
            expect(serialized).not.toContain('لهجة شامية');
            expect(serialized).not.toContain('أهلاً وسهلاً');
            expect(result!.settings).not.toHaveProperty('brandVoiceNotes');
            expect(result!.settings).not.toHaveProperty('greetingMessageMulti');
        });

        it('carries the Business Info health summary but never its text', async () => {
            const result = await partnerPortalService.getMerchantDetail('partner-1', 'merchant-1');

            expect(result!.pages[0].kb).toMatchObject({ kbLength: 2995, unresolvedGaps: 3 });
            expect(result!.pages[0]).not.toHaveProperty('knowledgeBase');
            expect(result!.pages[0]).not.toHaveProperty('accessToken');
        });

        it('derives the same lapsed-trial status the list shows', async () => {
            const result = await partnerPortalService.getMerchantDetail('partner-1', 'merchant-1');

            // Raw row still says 'trialing'; the trial end has passed.
            expect(result!.status).toBe('trial_expired');
        });

        it('passes the admin note through for the partner to act on', async () => {
            const result = await partnerPortalService.getMerchantDetail('partner-1', 'merchant-1');
            expect(result!.adminNote).toBe('اتصل به قبل الخميس');
        });
    });
});
