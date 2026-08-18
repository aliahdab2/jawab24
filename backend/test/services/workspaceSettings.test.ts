import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { WorkspaceSettings } from '@jawab24/shared';
import { WorkspaceSettingsService } from '../../src/services/workspaceSettings';
// Rule 10.6 in spirit: derive expected copy from the shipped source, never hardcode it.
import { t } from '../../src/utils/i18n';

/** Cast a partial stub to WorkspaceSettings — avoids broad `as any` at each call site. */
function partial(s: Partial<WorkspaceSettings>): WorkspaceSettings {
    return s as WorkspaceSettings;
}

// ── Mocks ─────────────────────────────────────────────────────────────────────

const { mockCaptureError } = vi.hoisted(() => ({
    mockCaptureError: vi.fn(),
}));

vi.mock('../../src/db', () => ({
    db: {
        select: vi.fn(),
        update: vi.fn(),
    },
}));

vi.mock('../../src/db/schema', () => ({
    workspaces: { id: 'id', settings: 'settings', updatedAt: 'updated_at' },
    workspaceMembers: { workspaceId: 'workspace_id', userId: 'user_id', role: 'role' },
    settings: { userId: 'user_id' },
}));

vi.mock('drizzle-orm', () => ({
    eq: vi.fn((field, value) => ({ field, value, op: 'eq' })),
    and: vi.fn((...args: unknown[]) => ({ args, op: 'and' })),
}));

vi.mock('../../src/lib/redis', () => ({
    redis: {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue('OK'),
        del: vi.fn().mockResolvedValue(1),
    },
}));

vi.mock('../../src/utils/sentryHelpers', () => ({
    captureError: mockCaptureError,
}));

import { db } from '../../src/db';
import { redis } from '../../src/lib/redis';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a single-call db.select chain returning the given rows. */
function buildSelectChain(rows: unknown[]) {
    return {
        from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue(rows),
            }),
        }),
    };
}

/**
 * Set up db.select to return results in sequence:
 *   calls[0] → workspaces fetch
 *   calls[1] → workspaceMembers owner lookup     (optional)
 *   calls[2] → settings legacy row lookup        (optional)
 */
function mockDbSelectSequence(...rowSets: unknown[][]) {
    let callIndex = 0;
    vi.mocked(db.select).mockImplementation(() => {
        const rows = rowSets[callIndex] ?? [];
        callIndex++;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return buildSelectChain(rows) as any;
    });
}

function mockDbUpdate() {
    const setMock = vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(db.update).mockReturnValue({ set: setMock } as any);
    return { set: setMock };
}

/** A complete workspace JSONB that satisfies all pipeline fields so drift is NOT triggered. */
const FULL_JSONB = {
    commentsAutoReply: true,
    messagesAutoReply: true,
    businessHoursOnly: false,
    businessHoursStart: '09:00',
    businessHoursEnd: '18:00',
    timezone: 'Asia/Damascus',
    aiEnabled: true,
    aiModel: 'gpt-4o-mini',
    commentReplyMode: 'public',
    likeComments: false,
    dualReplyNudge: '',
    dualReplyNudgeMulti: {},
    dualReplyNudgeVariations: {},
    replyDelay: 0,
    greetingMessageMulti: {},
    greetingMessageEnabled: false,
    awayMessageMulti: {},
    limitFallbackEnabled: false,
    limitFallbackMessageMulti: {},
    handoffPauseDurationMinutes: 30,
    commentEscalationMinutes: 60,
    messageEscalationMinutes: 30,
    defaultReplyLanguage: 'ar',
    supportedLanguages: ['en', 'ar'],
    autoDetectLanguage: true,
    replyStyle: 'professional',
    replyMode: 'sales',
    brandVoiceNotes: '',
    brandVoiceNotesMulti: {},
    holdLowConfidence: false,
};

const WS_ID = 'ws-test-123';
const OWNER_ID = 'user-owner-456';

describe('WorkspaceSettingsService', () => {
    let service: WorkspaceSettingsService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new WorkspaceSettingsService();
    });

    afterEach(() => {
        vi.resetAllMocks();
    });

    // ── getSettings ───────────────────────────────────────────────────────
    describe('getSettings', () => {
        it('returns cached value from Redis without hitting DB', async () => {
            const cached = { aiEnabled: false, commentsAutoReply: false };
            vi.mocked(redis.get).mockResolvedValueOnce(JSON.stringify(cached));

            const result = await service.getSettings(WS_ID);

            expect(result.aiEnabled).toBe(false);
            expect(db.select).not.toHaveBeenCalled();
        });

        it('fetches from DB when cache is empty and merges with defaults', async () => {
            vi.mocked(redis.get).mockResolvedValueOnce(null);
            // Workspace has full JSONB — no drift triggered (only 1 db.select call)
            mockDbSelectSequence([{ settings: { ...FULL_JSONB, aiEnabled: false } }]);

            const result = await service.getSettings(WS_ID);

            expect(result.aiEnabled).toBe(false);
            // Defaults still applied for unset fields
            expect(result.commentsAutoReply).toBe(true);
            expect(result.replyDelay).toBe(0);
        });

        it('returns full defaults when workspace not found in DB', async () => {
            vi.mocked(redis.get).mockResolvedValueOnce(null);
            mockDbSelectSequence([]); // workspace not found

            const result = await service.getSettings(WS_ID);

            expect(result.aiEnabled).toBe(true);
            expect(result.commentsAutoReply).toBe(true);
            expect(result.messagesAutoReply).toBe(true);
            expect(result.defaultReplyLanguage).toBe('ar');
        });

        it('falls through to DB when Redis throws', async () => {
            vi.mocked(redis.get).mockRejectedValueOnce(new Error('Redis down'));
            mockDbSelectSequence([{ settings: { ...FULL_JSONB, replyDelay: 5 } }]);

            const result = await service.getSettings(WS_ID);

            expect(result.replyDelay).toBe(5);
        });

        it('populates cache after DB fetch', async () => {
            vi.mocked(redis.get).mockResolvedValueOnce(null);
            mockDbSelectSequence([{ settings: FULL_JSONB }]);

            await service.getSettings(WS_ID);

            expect(redis.set).toHaveBeenCalledWith(
                expect.stringContaining(WS_ID),
                expect.any(String),
                'EX',
                300,
            );
        });
    });

    // ── drift detection ───────────────────────────────────────────────────
    describe('getSettings — drift detection', () => {
        it('recovers missing pipeline field from legacy owner row and triggers write-back', async () => {
            vi.mocked(redis.get).mockResolvedValueOnce(null);
            // Workspace JSONB is missing commentReplyMode (and many other pipeline fields)
            const partialJsonb = { ...FULL_JSONB };
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            delete (partialJsonb as any).commentReplyMode;

            mockDbSelectSequence(
                [{ settings: partialJsonb }],               // workspace fetch
                [{ userId: OWNER_ID }],                     // owner lookup
                [{ commentReplyMode: 'dual' }],             // legacy settings row
            );
            const { set: setMock } = mockDbUpdate();

            const result = await service.getSettings(WS_ID);

            // Recovered value returned
            expect(result.commentReplyMode).toBe('dual');
            // Write-back was triggered with the merged JSONB
            expect(db.update).toHaveBeenCalled();
            expect(setMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    settings: expect.objectContaining({ commentReplyMode: 'dual' }),
                }),
            );
        });

        it('skips write-back when JSONB already contains all pipeline fields', async () => {
            vi.mocked(redis.get).mockResolvedValueOnce(null);
            // Full JSONB — drift detection short-circuits (missing.length === 0)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            mockDbSelectSequence([{ settings: FULL_JSONB }]);

            await service.getSettings(WS_ID);

            // Only 1 db.select call (workspace) — no owner/legacy lookups
            expect(vi.mocked(db.select)).toHaveBeenCalledTimes(1);
            expect(db.update).not.toHaveBeenCalled();
        });

        it('returns defaults without write when workspace_members has no owner row', async () => {
            vi.mocked(redis.get).mockResolvedValueOnce(null);
            const partialJsonb = { ...FULL_JSONB };
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            delete (partialJsonb as any).commentReplyMode;

            mockDbSelectSequence(
                [{ settings: partialJsonb }],  // workspace fetch
                [],                             // no owner found
            );

            const result = await service.getSettings(WS_ID);

            // Falls back to DEFAULTS for missing field
            expect(result.commentReplyMode).toBe('public');
            expect(db.update).not.toHaveBeenCalled();
        });

        it('captures error and returns DEFAULTS when detectLegacyDrift throws', async () => {
            vi.mocked(redis.get).mockResolvedValueOnce(null);
            const partialJsonb = { ...FULL_JSONB };
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            delete (partialJsonb as any).commentReplyMode;

            // First call (workspace) succeeds; second call (owner lookup) throws
            let callIndex = 0;
            vi.mocked(db.select).mockImplementation(() => {
                callIndex++;
                if (callIndex === 1) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    return buildSelectChain([{ settings: partialJsonb }]) as any;
                }
                // Drift detection inner query throws
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                return {
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            limit: vi.fn().mockRejectedValue(new Error('DB timeout')),
                        }),
                    }),
                } as any;
            });

            const result = await service.getSettings(WS_ID);

            // Error captured via captureError
            expect(mockCaptureError).toHaveBeenCalledWith(
                expect.any(Error),
                'workspaceSettings drift detection failed',
                expect.objectContaining({ tags: { service: 'workspace-settings', action: 'drift-detect' } }),
            );
            // getSettings did NOT throw — fell back to defaults for missing field
            expect(result.commentReplyMode).toBe('public');
            // No write attempted
            expect(db.update).not.toHaveBeenCalled();
        });
    });

    // ── updateSettings ────────────────────────────────────────────────────
    describe('updateSettings', () => {
        it('merges updates with existing settings and invalidates cache', async () => {
            // First call is getSettings (inside updateSettings) — full JSONB to avoid drift
            vi.mocked(redis.get).mockResolvedValueOnce(null);
            mockDbSelectSequence([{ settings: { ...FULL_JSONB, aiEnabled: true, replyDelay: 0 } }]);
            mockDbUpdate();

            const result = await service.updateSettings(WS_ID, { replyDelay: 10 });

            expect(result.replyDelay).toBe(10);
            expect(result.aiEnabled).toBe(true); // Existing value preserved
            expect(redis.del).toHaveBeenCalledWith(expect.stringContaining(WS_ID));
        });
    });

    // ── isCommentsAutoReplyEnabled ────────────────────────────────────────
    describe('isCommentsAutoReplyEnabled', () => {
        it('returns false when commentsAutoReply is off', async () => {
            vi.spyOn(service, 'getSettings').mockResolvedValue(partial({
                commentsAutoReply: false,
                businessHoursOnly: false,
            }));

            expect(await service.isCommentsAutoReplyEnabled(WS_ID)).toBe(false);
        });

        it('returns true when commentsAutoReply is on and no business hours restriction', async () => {
            vi.spyOn(service, 'getSettings').mockResolvedValue(partial({
                commentsAutoReply: true,
                businessHoursOnly: false,
            }));

            expect(await service.isCommentsAutoReplyEnabled(WS_ID)).toBe(true);
        });

        it('delegates to business hours check when businessHoursOnly is true', async () => {
            vi.spyOn(service, 'getSettings').mockResolvedValue(partial({
                commentsAutoReply: true,
                businessHoursOnly: true,
                businessHoursStart: '00:00',
                businessHoursEnd: '23:59',
                timezone: 'UTC',
            }));

            // 00:00–23:59 UTC covers all times
            expect(await service.isCommentsAutoReplyEnabled(WS_ID)).toBe(true);
        });
    });

    // ── isMessagesAutoReplyEnabled ────────────────────────────────────────
    describe('isMessagesAutoReplyEnabled', () => {
        it('returns false when messagesAutoReply is off', async () => {
            vi.spyOn(service, 'getSettings').mockResolvedValue(partial({
                messagesAutoReply: false,
                businessHoursOnly: false,
            }));

            expect(await service.isMessagesAutoReplyEnabled(WS_ID)).toBe(false);
        });

        it('returns true when messagesAutoReply is on', async () => {
            vi.spyOn(service, 'getSettings').mockResolvedValue(partial({
                messagesAutoReply: true,
                businessHoursOnly: false,
            }));

            expect(await service.isMessagesAutoReplyEnabled(WS_ID)).toBe(true);
        });
    });

    // ── getAwayMessage ────────────────────────────────────────────────────
    describe('getAwayMessage', () => {
        it('returns configured away message for detected language', async () => {
            // defaultReplyLanguage:'en' so resolveLanguage('en') → 'en', resolveLanguage('ar') → 'ar'
            vi.spyOn(service, 'getSettings').mockResolvedValue(partial({
                awayMessageMulti: { en: 'We are away', ar: 'نحن غائبون' },
                autoDetectLanguage: true,
                defaultReplyLanguage: 'en',
            }));

            expect(await service.getAwayMessage(WS_ID, 'en')).toBe('We are away');
            expect(await service.getAwayMessage(WS_ID, 'ar')).toBe('نحن غائبون');
        });

        it('falls back to other language when preferred is missing', async () => {
            vi.spyOn(service, 'getSettings').mockResolvedValue(partial({
                awayMessageMulti: { en: 'We are away' },
                autoDetectLanguage: true,
                defaultReplyLanguage: 'ar',
            }));

            // Arabic requested but only English configured — returns English
            expect(await service.getAwayMessage(WS_ID, 'ar')).toBe('We are away');
        });

        it('returns default away message when none configured', async () => {
            // defaultReplyLanguage:'en' so resolveLanguage('en') → 'en' → DEFAULT_AWAY_MESSAGE['en']
            vi.spyOn(service, 'getSettings').mockResolvedValue(partial({
                awayMessageMulti: {},
                autoDetectLanguage: true,
                defaultReplyLanguage: 'en',
            }));

            const msg = await service.getAwayMessage(WS_ID, 'en');
            expect(msg).toContain('away');
        });

        // The permanent-off branch (messagesAutoReply=false) passes allowDefault:false —
        // a merchant who switched DMs off never authored the shipped default and the UI
        // gates the field behind Business Hours, so it must never speak for them.
        it('returns null instead of the shipped default when allowDefault is false', async () => {
            vi.spyOn(service, 'getSettings').mockResolvedValue(partial({
                awayMessageMulti: {},
                autoDetectLanguage: true,
                defaultReplyLanguage: 'en',
            }));

            expect(await service.getAwayMessage(WS_ID, 'en', { allowDefault: false })).toBeNull();
        });

        it('still returns merchant-authored text when allowDefault is false', async () => {
            vi.spyOn(service, 'getSettings').mockResolvedValue(partial({
                awayMessageMulti: { ar: 'مغلقون للجرد السنوي' },
                autoDetectLanguage: true,
                defaultReplyLanguage: 'ar',
            }));

            expect(await service.getAwayMessage(WS_ID, 'ar', { allowDefault: false }))
                .toBe('مغلقون للجرد السنوي');
        });

        // sourceLang is bookkeeping, not copy. Before pickMultilingualText excluded it,
        // an all-languages-cleared record {ar:'', en:'', sourceLang:'manual'} made the
        // any-other-language fallback send the literal string "manual" to a customer.
        it('never leaks the sourceLang bookkeeping key as the away text', async () => {
            vi.spyOn(service, 'getSettings').mockResolvedValue(partial({
                awayMessageMulti: { ar: '', en: '', sourceLang: 'manual' },
                autoDetectLanguage: true,
                defaultReplyLanguage: 'en',
            }));

            expect(await service.getAwayMessage(WS_ID, 'en', { allowDefault: false })).toBeNull();
            // With defaults allowed, it falls through to the shipped default — not "manual".
            expect(await service.getAwayMessage(WS_ID, 'en')).toContain('away');
        });
    });

    // ── getGreetingMessage ────────────────────────────────────────────────
    describe('getGreetingMessage', () => {
        it('returns greeting for detected language', async () => {
            // defaultReplyLanguage:'en' so resolveLanguage('en') → 'en'
            vi.spyOn(service, 'getSettings').mockResolvedValue(partial({
                greetingMessageMulti: { en: 'Welcome!', ar: 'مرحباً!' },
                autoDetectLanguage: true,
                defaultReplyLanguage: 'en',
            }));

            expect(await service.getGreetingMessage(WS_ID, 'en')).toBe('Welcome!');
        });

        // Toggle ON + empty field must still produce a welcome: the merchant was
        // shown a placeholder in the settings box and reasonably expects THAT to be
        // what new customers receive. Returning null sent nothing at all — measured
        // 2026-08-18: 56 of 83 workspaces carry an empty `{}` (every one created
        // since 2026-05-14, because auth.createDefaultWorkspace seeds no greeting),
        // and five of those had the toggle ON and were silently sending nothing.
        it('falls back to the shipped default when the merchant authored nothing', async () => {
            vi.spyOn(service, 'getSettings').mockResolvedValue(partial({
                greetingMessageMulti: {},
                autoDetectLanguage: true,
                defaultReplyLanguage: 'en',
            }));

            const msg = await service.getGreetingMessage(WS_ID, 'en');
            expect(msg).toBe(t('defaultGreeting', 'en'));
        });

        it('falls back to the Arabic default for an Arabic customer', async () => {
            vi.spyOn(service, 'getSettings').mockResolvedValue(partial({
                greetingMessageMulti: {},
                autoDetectLanguage: true,
                defaultReplyLanguage: 'ar',
            }));

            const msg = await service.getGreetingMessage(WS_ID, 'ar');
            expect(msg).toBe(t('defaultGreeting', 'ar'));
            expect(msg).not.toBe(t('defaultGreeting', 'en'));
        });

        it('prefers the merchant text over the default when both could apply', async () => {
            vi.spyOn(service, 'getSettings').mockResolvedValue(partial({
                greetingMessageMulti: { en: 'Our own welcome' },
                autoDetectLanguage: true,
                defaultReplyLanguage: 'en',
            }));

            expect(await service.getGreetingMessage(WS_ID, 'en')).toBe('Our own welcome');
        });

        it('never leaks the sourceLang bookkeeping key as the greeting text', async () => {
            // All languages cleared but the bookkeeping key present. The value must
            // never be sent to a customer as if it were the greeting; with every
            // language empty this is the same "authored nothing" case as above.
            vi.spyOn(service, 'getSettings').mockResolvedValue(partial({
                greetingMessageMulti: { ar: '', en: '', sourceLang: 'default' },
                autoDetectLanguage: true,
                defaultReplyLanguage: 'en',
            }));

            const msg = await service.getGreetingMessage(WS_ID, 'en');
            expect(msg).toBe(t('defaultGreeting', 'en'));
            expect(msg).not.toBe('default');
        });
    });

    // ── getLimitFallbackMessage ───────────────────────────────────────────
    describe('getLimitFallbackMessage', () => {
        it('returns configured message for detected language', async () => {
            vi.spyOn(service, 'getSettings').mockResolvedValue(partial({
                limitFallbackMessageMulti: { en: 'We hit our limit', ar: 'تجاوزنا الحد' },
                autoDetectLanguage: true,
                defaultReplyLanguage: 'en',
            }));

            expect(await service.getLimitFallbackMessage(WS_ID, 'en')).toBe('We hit our limit');
            expect(await service.getLimitFallbackMessage(WS_ID, 'ar')).toBe('تجاوزنا الحد');
        });

        it('falls back to other language when preferred is missing', async () => {
            vi.spyOn(service, 'getSettings').mockResolvedValue(partial({
                limitFallbackMessageMulti: { en: 'We hit our limit' },
                autoDetectLanguage: true,
                defaultReplyLanguage: 'ar',
            }));

            expect(await service.getLimitFallbackMessage(WS_ID, 'ar')).toBe('We hit our limit');
        });

        it('returns null when nothing configured (caller falls back to hardcoded)', async () => {
            vi.spyOn(service, 'getSettings').mockResolvedValue(partial({
                limitFallbackMessageMulti: {},
                autoDetectLanguage: true,
                defaultReplyLanguage: 'en',
            }));

            expect(await service.getLimitFallbackMessage(WS_ID, 'en')).toBeNull();
        });

        it('does not leak the sourceLang metadata key as a fallback message', async () => {
            // Smart-translation stores `sourceLang` alongside language entries.
            // A naive Object.values() would return the literal string 'en' to the customer.
            vi.spyOn(service, 'getSettings').mockResolvedValue(partial({
                limitFallbackMessageMulti: { sourceLang: 'en' } as Record<string, string>,
                autoDetectLanguage: true,
                defaultReplyLanguage: 'ar',
            }));

            expect(await service.getLimitFallbackMessage(WS_ID, 'ar')).toBeNull();
        });
    });

    // ── getReplyDelay ─────────────────────────────────────────────────────
    describe('getReplyDelay', () => {
        it('returns configured delay in seconds', async () => {
            vi.spyOn(service, 'getSettings').mockResolvedValue(partial({ replyDelay: 3 }));
            expect(await service.getReplyDelay(WS_ID)).toBe(3);
        });
    });

    // ── language resolution ───────────────────────────────────────────────
    describe('language resolution', () => {
        it('uses default language when autoDetect is off', async () => {
            vi.spyOn(service, 'getSettings').mockResolvedValue(partial({
                greetingMessageMulti: { en: 'Hi', ar: 'مرحباً' },
                autoDetectLanguage: false,
                defaultReplyLanguage: 'en',
            }));

            // Even if customer wrote in Arabic, we use the default (en)
            expect(await service.getGreetingMessage(WS_ID, 'ar')).toBe('Hi');
        });

        it('uses detected language when autoDetect is on', async () => {
            vi.spyOn(service, 'getSettings').mockResolvedValue(partial({
                greetingMessageMulti: { en: 'Hi', ar: 'مرحباً' },
                autoDetectLanguage: true,
                defaultReplyLanguage: 'en',
            }));

            expect(await service.getGreetingMessage(WS_ID, 'ar')).toBe('مرحباً');
        });

        it('falls back to default when detected language is "unknown"', async () => {
            vi.spyOn(service, 'getSettings').mockResolvedValue(partial({
                greetingMessageMulti: { en: 'Hi', ar: 'مرحباً' },
                autoDetectLanguage: true,
                defaultReplyLanguage: 'en',
            }));

            expect(await service.getGreetingMessage(WS_ID, 'unknown')).toBe('Hi');
        });
    });
});
