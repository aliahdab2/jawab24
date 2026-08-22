import { describe, it, expect } from 'vitest';
import { DEFAULT_AI_MODEL, PLACEHOLDER_TIMEZONE } from '@jawab24/shared';
import {
    computeHealthFlags,
    computeNonDefaultKeys,
    isPlaceholderPersona,
    overlayPipelineSettings,
    resolvePipelineWorkspaceId,
    SETTINGS_DEFAULTS,
    SUPPORT_SETTINGS_KEYS,
    type HealthInput,
    type HealthInputPage,
    type SupportSettings,
    type PageKbSummary,
} from '../services/admin/health';
import { DEFAULTS as WORKSPACE_DEFAULTS, NEW_SIGNUP_SETTINGS_SEED } from '../services/workspaceSettings';
import { settings } from '../db/schema';

/**
 * Unit coverage for the admin support-console health flags. All pure — plain
 * fixtures, no DB. Guards the flag contract the frontend renders against.
 */

const NOW = new Date('2026-07-24T12:00:00Z');

/** A fully healthy settings row (every field at its default, persona set). */
function healthySettings(overrides: Partial<SupportSettings> = {}): SupportSettings {
    return {
        aiEnabled: true,
        aiModel: DEFAULT_AI_MODEL,
        commentsAutoReply: true,
        messagesAutoReply: true,
        commentReplyMode: 'public',
        holdLowConfidence: false,
        businessHoursOnly: false,
        businessHoursStart: '09:00',
        businessHoursEnd: '18:00',
        timezone: PLACEHOLDER_TIMEZONE,
        replyStyle: 'professional',
        brandVoiceNotes: 'نتحدث بلطف ونساعد العميل بسرعة',
        brandVoiceNotesMulti: {},
        greetingMessageEnabled: false,
        greetingMessageMulti: {},
        awayMessageMulti: {},
        limitFallbackEnabled: false,
        replyDelay: 3,
        defaultReplyLanguage: 'ar',
        supportedLanguages: ['en', 'ar'],
        autoDetectLanguage: true,
        newLeadAlertsEnabled: true,
        notificationsEnabled: true,
        onboardingCompletedAt: new Date('2026-06-01T00:00:00Z'),
        createdAt: new Date('2026-05-01T00:00:00Z'),
        updatedAt: new Date('2026-06-10T00:00:00Z'),
        ...overrides,
    };
}

function healthyKb(overrides: Partial<PageKbSummary> = {}): PageKbSummary {
    return {
        kbLength: 4000,
        kbActiveVersion: 3,
        kbUpdatedAt: new Date('2026-06-15T00:00:00Z'),
        chunksTotal: 20,
        chunksByType: { offering: 12, faq: 5, info: 3 },
        unresolvedGaps: 0,
        businessProfileFields: 8,
        catalogItems: 0,
        factCollections: 0,
        factRows: 0,
        newestChunkVersion: 3,
        chunksStale: false,
        onRetrievalPath: false,
        hasAnyContent: true,
        ...overrides,
    };
}

/**
 * A page whose Business Info lives ONLY in a structured store — no free text and
 * no chunks. This is the shape that the pre-2026-08-20 flags called empty, and
 * the reason `hasAnyContent` exists: `kbLength === 0 || chunksTotal === 0` was
 * true here even though the merchant had filled everything in.
 */
function structuredOnlyKb(overrides: Partial<PageKbSummary> = {}): PageKbSummary {
    return healthyKb({
        kbLength: 0,
        chunksTotal: 0,
        chunksByType: {},
        newestChunkVersion: null,
        businessProfileFields: 9,
        catalogItems: 12,
        hasAnyContent: true,
        ...overrides,
    });
}

function healthyPage(overrides: Partial<HealthInputPage> = {}): HealthInputPage {
    return {
        id: 'page-1',
        name: 'متجر تجريبي',
        disconnected: false,
        autoReplyEnabled: true,
        autoReplyDisabledReason: null,
        ...overrides,
        // AFTER the spread: `kb` must be the MERGED summary, so a case may pass a
        // partial (`{ kb: { catalogItems: 0 } }`) and still get every other field
        // at its healthy default. With `kb` before the spread the caller's raw
        // object won and silently dropped the defaults — which now matters,
        // because a kb missing `businessProfileFields` reads as no content and
        // would fire kb_empty in a test that never mentioned emptiness.
        kb: healthyKb(overrides.kb),
    };
}

function healthyInput(overrides: Partial<HealthInput> = {}): HealthInput {
    return {
        now: NOW,
        lastSeenAt: new Date('2026-07-23T00:00:00Z'),
        settings: healthySettings(),
        subscription: { status: 'active', trialEndsAt: null, autoReplyAllowed: true, entitlementEndsAt: null },
        pages: [healthyPage()],
        usage: { aiRepliesCount: 100, limit: 1000, topupBalance: 0 },
        isTeamMemberOnly: false,
        ...overrides,
    };
}

const keys = (flags: { key: string }[]) => flags.map(f => f.key);

describe('computeHealthFlags — healthy baseline', () => {
    it('a fully-configured active merchant raises no red or yellow flags', () => {
        const flags = computeHealthFlags(healthyInput());
        expect(flags.filter(f => f.severity !== 'info')).toEqual([]);
    });
});

describe('computeHealthFlags — RED triggers in isolation', () => {
    it('no_pages when the merchant owns none and is not a team member', () => {
        const flags = computeHealthFlags(healthyInput({ pages: [] }));
        expect(keys(flags)).toContain('no_pages');
    });

    it('no no_pages when the user is only a team member elsewhere', () => {
        const flags = computeHealthFlags(healthyInput({ pages: [], isTeamMemberOnly: true }));
        expect(keys(flags)).not.toContain('no_pages');
        expect(keys(flags)).toContain('team_member');
    });

    it('ai_disabled when the master AI switch is off', () => {
        const flags = computeHealthFlags(healthyInput({ settings: healthySettings({ aiEnabled: false }) }));
        expect(keys(flags)).toContain('ai_disabled');
    });

    it('one channel off is yellow channel_silent with the channel in meta', () => {
        const flags = computeHealthFlags(healthyInput({
            settings: healthySettings({ commentsAutoReply: false }),
        }));
        const f = flags.find(x => x.key === 'channel_silent');
        expect(f?.severity).toBe('yellow');
        expect(f?.meta?.channel).toBe('comments');
        expect(keys(flags)).not.toContain('all_channels_silent');
    });

    it('both channels off is a single red all_channels_silent', () => {
        const flags = computeHealthFlags(healthyInput({
            settings: healthySettings({ commentsAutoReply: false, messagesAutoReply: false }),
        }));
        const silent = flags.filter(f => f.key === 'all_channels_silent');
        expect(silent).toHaveLength(1);
        expect(silent[0].severity).toBe('red');
        expect(keys(flags)).not.toContain('channel_silent');
    });

    it('page_disconnected when the access token is cleared', () => {
        const flags = computeHealthFlags(healthyInput({ pages: [healthyPage({ disconnected: true })] }));
        expect(keys(flags)).toContain('page_disconnected');
    });

    it('auto_reply_system_off (red) for a system reason, not user', () => {
        const flags = computeHealthFlags(healthyInput({
            pages: [healthyPage({ autoReplyEnabled: false, autoReplyDisabledReason: 'trial_block' })],
        }));
        const f = flags.find(x => x.key === 'auto_reply_system_off');
        expect(f?.severity).toBe('red');
        expect(f?.meta?.reason).toBe('trial_block');
    });

    it('auto_reply_user_off (yellow) when the merchant turned it off deliberately', () => {
        const flags = computeHealthFlags(healthyInput({
            pages: [healthyPage({ autoReplyEnabled: false, autoReplyDisabledReason: 'user' })],
        }));
        const f = flags.find(x => x.key === 'auto_reply_user_off');
        expect(f?.severity).toBe('yellow');
        expect(keys(flags)).not.toContain('auto_reply_system_off');
    });

    it('auto-reply off with a NULL reason still surfaces (auto_reply_off_unknown), never healthy', () => {
        const flags = computeHealthFlags(healthyInput({
            pages: [healthyPage({ autoReplyEnabled: false, autoReplyDisabledReason: null })],
        }));
        const f = flags.find(x => x.key === 'auto_reply_off_unknown');
        expect(f?.severity).toBe('yellow');
        expect(keys(flags)).not.toContain('auto_reply_user_off');
        expect(keys(flags)).not.toContain('auto_reply_system_off');
    });

    it('kb_empty only when EVERY Business Info store is empty', () => {
        const flags = computeHealthFlags(healthyInput({
            pages: [healthyPage({
                kb: healthyKb({
                    kbLength: 0, chunksTotal: 0, chunksByType: {},
                    businessProfileFields: 0, catalogItems: 0, factCollections: 0, factRows: 0,
                    newestChunkVersion: null,
                }),
            })],
        }));
        expect(keys(flags)).toContain('kb_empty');
        // Empty short-circuits the offering/thin checks.
        expect(keys(flags)).not.toContain('no_offering_chunks');
        expect(keys(flags)).not.toContain('kb_thin');
    });

    /**
     * THE regression. A structured write bumps kbActiveVersion without
     * re-ingesting, so the chunk index reads 0 while the merchant's text and
     * profile are untouched. The old predicate (`kbLength === 0 || chunksTotal
     * === 0`) called this empty and painted the account RED — 49 of 92 live prod
     * pages on 2026-08-20, «Shahin Resort» among them with 10,494 KB characters.
     */
    it('a full KB whose chunk index was outrun by the active version is NOT empty', () => {
        const flags = computeHealthFlags(healthyInput({
            pages: [healthyPage({
                kb: healthyKb({
                    kbLength: 10494, businessProfileFields: 10,
                    kbActiveVersion: 54, newestChunkVersion: 51,
                    chunksTotal: 0, chunksByType: {}, chunksStale: true,
                }),
            })],
        }));
        expect(keys(flags)).not.toContain('kb_empty');
        expect(keys(flags)).not.toContain('kb_thin');
        // Nor may a stale index be reported as a pricing failure.
        expect(keys(flags)).not.toContain('no_offering_chunks');
    });

    it('a page whose Business Info is only structured (no free text, no chunks) is NOT empty', () => {
        const flags = computeHealthFlags(healthyInput({
            pages: [healthyPage({ kb: structuredOnlyKb() })],
        }));
        expect(keys(flags)).not.toContain('kb_empty');
        expect(keys(flags)).not.toContain('kb_thin');
    });

    it('kb_thin needs thin free text AND nothing in any structured store', () => {
        const thin = computeHealthFlags(healthyInput({
            pages: [healthyPage({
                kb: healthyKb({ kbLength: 120, businessProfileFields: 0, catalogItems: 0, factRows: 0 }),
            })],
        }));
        expect(keys(thin)).toContain('kb_thin');
    });

    it('kb_thin does NOT fire on the typical short-prose page that has structured facts', () => {
        // The calibration that matters: the fleet MEDIAN page holds 148
        // characters (measured 2026-08-20), so the <500 bound alone matches 71 of
        // 92 live pages. A single real fact — one phone, one catalog item — is
        // enough to make "the AI has little to answer from" the wrong sentence.
        for (const store of [
            { businessProfileFields: 1 },
            { catalogItems: 1 },
            { factRows: 1, factCollections: 1 },
        ]) {
            const flags = computeHealthFlags(healthyInput({
                pages: [healthyPage({
                    kb: healthyKb({
                        kbLength: 148, businessProfileFields: 0, catalogItems: 0, factRows: 0, ...store,
                    }),
                })],
            }));
            expect(keys(flags), JSON.stringify(store)).not.toContain('kb_thin');
        }
    });

    it('no_offering_chunks is RED for a product KB with little FAQ', () => {
        const flags = computeHealthFlags(healthyInput({
            pages: [healthyPage({ kb: healthyKb({ chunksByType: { info: 12, faq: 1 } }) })],
        }));
        const f = flags.find(x => x.key === 'no_offering_chunks');
        expect(f?.severity).toBe('red');
    });

    it('no_offering_chunks downgrades to YELLOW for a substantial FAQ/service KB', () => {
        const flags = computeHealthFlags(healthyInput({
            pages: [healthyPage({ kb: healthyKb({ chunksByType: { faq: 8, info: 12 } }) })],
        }));
        const f = flags.find(x => x.key === 'no_offering_chunks');
        expect(f?.severity).toBe('yellow');
    });

    it('catalog items settle the offerings question — no chunk can contradict them', () => {
        const flags = computeHealthFlags(healthyInput({
            pages: [healthyPage({
                kb: healthyKb({ chunksByType: { info: 12, faq: 1 }, catalogItems: 40 }),
            })],
        }));
        expect(keys(flags)).not.toContain('no_offering_chunks');
    });

    it('kb_chunks_stale fires only where replies actually read the index', () => {
        const stale = healthyKb({
            kbActiveVersion: 54, newestChunkVersion: 51,
            chunksTotal: 0, chunksByType: {}, chunksStale: true,
        });

        const reading = computeHealthFlags(healthyInput({
            pages: [healthyPage({ kb: healthyKb({ ...stale, onRetrievalPath: true, catalogItems: 5 }) })],
        }));
        expect(keys(reading)).toContain('kb_chunks_stale');

        // Off the retrieval path the page gets the full KB text and never reads a
        // chunk, so the stale index is invisible bookkeeping — flagging it would
        // colour 47 healthy prod accounts for a defect they do not have.
        const notReading = computeHealthFlags(healthyInput({
            pages: [healthyPage({ kb: healthyKb({ ...stale, onRetrievalPath: false }) })],
        }));
        expect(keys(notReading)).not.toContain('kb_chunks_stale');
    });

    it('trial_expired when a trialing sub is past its end date', () => {
        const flags = computeHealthFlags(healthyInput({
            subscription: { status: 'trialing', trialEndsAt: new Date('2026-07-20T00:00:00Z'), autoReplyAllowed: false, entitlementEndsAt: null },
        }));
        expect(keys(flags)).toContain('trial_expired');
    });

    it('subscription_inactive for past_due / canceled', () => {
        for (const status of ['past_due', 'canceled']) {
            const flags = computeHealthFlags(healthyInput({
                subscription: { status, trialEndsAt: null, autoReplyAllowed: false, entitlementEndsAt: null },
            }));
            const f = flags.find(x => x.key === 'subscription_inactive');
            expect(f?.meta?.status).toBe(status);
        }
    });

    it('subscription_inactive when the gate refuses a status-active manual plan', () => {
        // The regression. A manual (cash/transfer) plan never leaves 'active' — it
        // lapses at a snapped UTC-midnight boundary — so the old
        // `status in (past_due, canceled)` test could not see it, and the console
        // showed support a green "active" account whose every reply was refused.
        const flags = computeHealthFlags(healthyInput({
            subscription: { status: 'active', trialEndsAt: null, autoReplyAllowed: false, entitlementEndsAt: null },
        }));
        const f = flags.find(x => x.key === 'subscription_inactive');
        expect(f?.severity).toBe('red');
        expect(f?.meta?.status).toBe('active');
    });

    it('keeps a YELLOW grace warning for past_due while the gate still allows', () => {
        // Regression on the AUTO-RENEW path, introduced by moving this flag onto the
        // gate: `past_due` inside the 3-day retry window now passes the gate, so the
        // red `subscription_inactive` correctly stops firing — which silently deleted
        // support's only signal that a card had failed. Red was a lie (replies ARE
        // flowing); nothing at all was worse. Yellow, with the deadline, is the truth.
        const flags = computeHealthFlags(healthyInput({
            subscription: {
                status: 'past_due',
                trialEndsAt: null,
                autoReplyAllowed: true,
                // period end was 1 day ago → grace ends 2 days from now
                entitlementEndsAt: new Date(NOW.getTime() + 2 * 24 * 60 * 60 * 1000),
            },
        }));
        const f = flags.find(x => x.key === 'subscription_past_due_grace');
        expect(f?.severity).toBe('yellow');
        expect(f?.meta?.daysLeft).toBe(2);
        // Not both — replies have not stopped.
        expect(keys(flags)).not.toContain('subscription_inactive');
    });

    it('escalates past_due to red once the grace has burned out', () => {
        const flags = computeHealthFlags(healthyInput({
            subscription: {
                status: 'past_due',
                trialEndsAt: null,
                autoReplyAllowed: false,
                entitlementEndsAt: new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000),
            },
        }));
        expect(flags.find(x => x.key === 'subscription_inactive')?.severity).toBe('red');
        expect(keys(flags)).not.toContain('subscription_past_due_grace');
    });

    it('promises no deadline for a past_due row the gate will never block', () => {
        // currentPeriodEnd is nullable, and the gate's grace check is guarded on it —
        // so this row serves replies forever. The resolver returns null for exactly
        // that shape, and announcing "3 days left, then they stop" would hand support
        // a deadline that never arrives.
        const flags = computeHealthFlags(healthyInput({
            subscription: {
                status: 'past_due', trialEndsAt: null, autoReplyAllowed: true, entitlementEndsAt: null,
            },
        }));
        expect(keys(flags)).not.toContain('subscription_past_due_grace');
    });

    it('flags a refusing gate even when the row still looks like a live trial', () => {
        // The bypass: this used to sit behind `else if`, so a trialing row with a
        // FUTURE trialEndsAt matched the trial arm, found daysLeft over the
        // ending-soon threshold, and emitted NOTHING — a healthy chip over an
        // account the gate was refusing for an unrelated reason.
        const flags = computeHealthFlags(healthyInput({
            subscription: {
                status: 'trialing',
                trialEndsAt: new Date(NOW.getTime() + 20 * 24 * 60 * 60 * 1000),
                autoReplyAllowed: false,
                entitlementEndsAt: new Date(NOW.getTime() - 1 * 24 * 60 * 60 * 1000),
            },
        }));
        expect(flags.find(x => x.key === 'subscription_inactive')?.severity).toBe('red');
    });

    it('stays quiet when the gate allows, whatever the status reads', () => {
        const flags = computeHealthFlags(healthyInput({
            subscription: { status: 'active', trialEndsAt: null, autoReplyAllowed: true, entitlementEndsAt: null },
        }));
        expect(keys(flags)).not.toContain('subscription_inactive');
    });
});

describe('computeHealthFlags — usage boundaries', () => {
    const at = (aiRepliesCount: number, limit = 1000) =>
        keys(computeHealthFlags(healthyInput({ usage: { aiRepliesCount, limit, topupBalance: 0 } })));

    it('79% → no usage flag', () => {
        expect(at(790)).not.toContain('usage_near_cap');
        expect(at(790)).not.toContain('usage_over_cap');
    });
    it('80% → usage_near_cap', () => {
        expect(at(800)).toContain('usage_near_cap');
        expect(at(800)).not.toContain('usage_over_cap');
    });
    it('100% → usage_over_cap (not near)', () => {
        expect(at(1000)).toContain('usage_over_cap');
        expect(at(1000)).not.toContain('usage_near_cap');
    });
    it('101% → usage_over_cap', () => {
        expect(at(1010)).toContain('usage_over_cap');
    });
    it('null limit → no usage flags', () => {
        expect(keys(computeHealthFlags(healthyInput({ usage: { aiRepliesCount: 5000, limit: null, topupBalance: 0 } }))))
            .not.toContain('usage_over_cap');
    });
    it('limit_fallback_off fires near cap when fallback disabled', () => {
        const flags = computeHealthFlags(healthyInput({
            usage: { aiRepliesCount: 900, limit: 1000, topupBalance: 0 },
            settings: healthySettings({ limitFallbackEnabled: false }),
        }));
        expect(keys(flags)).toContain('limit_fallback_off');
    });
    it('no limit_fallback_off when fallback enabled', () => {
        const flags = computeHealthFlags(healthyInput({
            usage: { aiRepliesCount: 900, limit: 1000, topupBalance: 0 },
            settings: healthySettings({ limitFallbackEnabled: true }),
        }));
        expect(keys(flags)).not.toContain('limit_fallback_off');
    });
});

/**
 * A top-up balance makes the plan cap a billing boundary, not a wall:
 * canUseAiReplies falls through to top-up, so any flag claiming replies stop at
 * the cap is false. Regression coverage for the live report (87% of 10,000 with
 * a 9,417 top-up balance rendering "replies will go silent at the cap").
 *
 * The warnings key off the REAL wall (plan + top-up, via resolveAiQuotaStatus),
 * so a thin balance must NOT buy the same silence a large one does.
 */
describe('computeHealthFlags — usage with a top-up balance', () => {
    const withTopup = (aiRepliesCount: number, topupBalance: number, limitFallbackEnabled = false) =>
        computeHealthFlags(healthyInput({
            usage: { aiRepliesCount, limit: 1000, topupBalance },
            settings: healthySettings({ limitFallbackEnabled }),
        }));

    it('near cap + ample balance → usage_near_cap_on_topup, no bare near-cap flag', () => {
        const flags = withTopup(870, 9417);
        const f = flags.find(x => x.key === 'usage_near_cap_on_topup');
        expect(f?.severity).toBe('yellow');
        expect(f?.meta).toEqual({ used: 870, limit: 1000, percent: 87, balance: 9417 });
        expect(keys(flags)).not.toContain('usage_near_cap');
    });

    it('near cap + ample balance → NO limit_fallback_off (the fallback can never fire)', () => {
        expect(keys(withTopup(870, 9417))).not.toContain('limit_fallback_off');
    });

    it('at the cap + ample balance → usage_on_topup as info, not red usage_over_cap', () => {
        const flags = withTopup(1000, 500);
        const f = flags.find(x => x.key === 'usage_on_topup');
        expect(f?.severity).toBe('info');
        expect(f?.meta).toEqual({ used: 1000, limit: 1000, balance: 500 });
        expect(keys(flags)).not.toContain('usage_over_cap');
        expect(keys(flags)).not.toContain('limit_fallback_off');
    });

    it('a comfortably covered merchant raises no red flag', () => {
        expect(withTopup(1000, 500).filter(f => f.severity === 'red')).toEqual([]);
    });

    it('at the cap + NEARLY DRAINED balance → yellow drained warning, not a calm info line', () => {
        // 1000 plan + 3 top-up: replies stop after 3 more. Must not read as healthy.
        const flags = withTopup(1000, 3);
        const f = flags.find(x => x.key === 'usage_topup_nearly_drained');
        expect(f?.severity).toBe('yellow');
        expect(f?.meta).toEqual({ used: 1000, limit: 1000, balance: 3 });
        expect(keys(flags)).not.toContain('usage_on_topup');
    });

    it('a thin balance does NOT suppress limit_fallback_off', () => {
        // 850 of a 1050 real runway — the fallback matters again, so the warning
        // that it is switched off must come back.
        expect(keys(withTopup(850, 50))).toContain('limit_fallback_off');
    });

    it('a thin balance near the cap falls back to the plain near-cap warning', () => {
        const flags = withTopup(850, 50);
        expect(flags.find(x => x.key === 'usage_near_cap')?.severity).toBe('yellow');
        expect(keys(flags)).not.toContain('usage_near_cap_on_topup');
    });

    it('plan AND balance both spent → red usage_over_cap', () => {
        const flags = withTopup(1050, 50);
        expect(flags.find(x => x.key === 'usage_over_cap')?.severity).toBe('red');
        expect(keys(flags)).not.toContain('usage_on_topup');
        expect(keys(flags)).not.toContain('usage_topup_nearly_drained');
    });

    it('balance drained to 0 → the wall flags come back', () => {
        const flags = withTopup(1200, 0);
        expect(keys(flags)).toContain('usage_over_cap');
        expect(flags.find(x => x.key === 'usage_over_cap')?.severity).toBe('red');
        expect(keys(flags)).not.toContain('usage_on_topup');
    });

    it('near cap + ample balance + fallback ENABLED → still no fallback flag', () => {
        expect(keys(withTopup(870, 9417, true))).not.toContain('limit_fallback_off');
    });
});

describe('computeHealthFlags — trial ending window', () => {
    const trialEndingIn = (days: number) =>
        keys(computeHealthFlags(healthyInput({
            subscription: { status: 'trialing', trialEndsAt: new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000), autoReplyAllowed: true, entitlementEndsAt: null },
        })));

    it('3 days left → trial_ending_soon', () => {
        expect(trialEndingIn(2.5)).toContain('trial_ending_soon');
    });
    it('4 days left → no trial flag', () => {
        expect(trialEndingIn(4)).not.toContain('trial_ending_soon');
    });
});

describe('computeHealthFlags — settings warnings', () => {
    it('hold_low_confidence flag, escalated when KB is weak', () => {
        const weak = computeHealthFlags(healthyInput({
            settings: healthySettings({ holdLowConfidence: true }),
            pages: [healthyPage({
                kb: healthyKb({
                    kbLength: 0, chunksTotal: 0, chunksByType: {},
                    businessProfileFields: 0, catalogItems: 0, factRows: 0,
                }),
            })],
        }));
        const f = weak.find(x => x.key === 'hold_low_confidence');
        expect(f?.meta?.withWeakKb).toBe(1);
    });

    it('hold_low_confidence is NOT escalated when only the chunk index is stale', () => {
        const flags = computeHealthFlags(healthyInput({
            settings: healthySettings({ holdLowConfidence: true }),
            pages: [healthyPage({
                kb: healthyKb({
                    kbLength: 10494, businessProfileFields: 10,
                    chunksTotal: 0, chunksByType: {}, chunksStale: true,
                    kbActiveVersion: 54, newestChunkVersion: 51,
                }),
            })],
        }));
        const f = flags.find(x => x.key === 'hold_low_confidence');
        // The escalated string claims "the Business Info is empty/thin", which
        // for a 10k-character KB is simply false.
        expect(f?.meta?.withWeakKb).toBeUndefined();
    });

    it('page_persona_override names the pages the workspace persona does not reach', () => {
        const flags = computeHealthFlags(healthyInput({
            pages: [
                healthyPage({ id: 'p1', name: 'منتجع شاهين', brandVoiceNotesMulti: { ar: 'نتحدث بلهجة شامية' } }),
                healthyPage({ id: 'p2', name: 'عالم شاهين' }),
            ],
        }));
        const f = flags.find(x => x.key === 'page_persona_override');
        expect(f?.meta?.count).toBe(1);
        expect(String(f?.meta?.pages)).toContain('منتجع شاهين');
    });

    it('a sourceLang-only or whitespace-only page persona is NOT a pin', () => {
        const flags = computeHealthFlags(healthyInput({
            pages: [healthyPage({ brandVoiceNotesMulti: { sourceLang: 'ar', ar: '   ' } })],
        }));
        expect(keys(flags)).not.toContain('page_persona_override');
    });

    it('persona_placeholder is suppressed when EVERY page pins its own persona', () => {
        const placeholder = { brandVoiceNotes: '[Your Assistant Name]', brandVoiceNotesMulti: {} };

        // One page still inherits → the placeholder reaches customers.
        const reaching = computeHealthFlags(healthyInput({
            settings: healthySettings(placeholder),
            pages: [
                healthyPage({ id: 'p1', brandVoiceNotesMulti: { ar: 'نص' } }),
                healthyPage({ id: 'p2' }),
            ],
        }));
        expect(keys(reaching)).toContain('persona_placeholder');

        // Every page pinned → the placeholder is unreachable, so flagging it
        // sends support to fix text no customer ever sees.
        const unreachable = computeHealthFlags(healthyInput({
            settings: healthySettings(placeholder),
            pages: [healthyPage({ id: 'p1', brandVoiceNotesMulti: { ar: 'نص' } })],
        }));
        expect(keys(unreachable)).not.toContain('persona_placeholder');
    });

    it('business_hours_only carries hours + timezone and flags placeholder tz + missing away message', () => {
        const flags = computeHealthFlags(healthyInput({
            settings: healthySettings({ businessHoursOnly: true, awayMessageMulti: {} }),
        }));
        const bh = flags.find(x => x.key === 'business_hours_only');
        expect(bh?.meta?.timezone).toBe(PLACEHOLDER_TIMEZONE);
        expect(keys(flags)).toContain('timezone_default');
        expect(keys(flags)).toContain('no_away_message');
    });

    it('greeting_written_not_enabled when greeting text exists but the switch is off', () => {
        const flags = computeHealthFlags(healthyInput({
            settings: healthySettings({ greetingMessageEnabled: false, greetingMessageMulti: { ar: 'مرحبا' } }),
        }));
        expect(keys(flags)).toContain('greeting_written_not_enabled');
    });

    it('unresolved_kb_gaps carries the count', () => {
        const flags = computeHealthFlags(healthyInput({
            pages: [healthyPage({ kb: healthyKb({ unresolvedGaps: 7 }) })],
        }));
        expect(flags.find(x => x.key === 'unresolved_kb_gaps')?.meta?.count).toBe(7);
    });
});

describe('computeHealthFlags — dormancy', () => {
    it('merchant_dormant when last seen > 14 days ago', () => {
        const flags = computeHealthFlags(healthyInput({ lastSeenAt: new Date('2026-07-01T00:00:00Z') }));
        const f = flags.find(x => x.key === 'merchant_dormant');
        expect(f?.severity).toBe('yellow');
        expect(Number(f?.meta?.days)).toBeGreaterThan(14);
    });
    it('never-seen merchant is dormant with days = -1', () => {
        const flags = computeHealthFlags(healthyInput({ lastSeenAt: null }));
        expect(flags.find(x => x.key === 'merchant_dormant')?.meta?.days).toBe(-1);
    });
    it('recently active merchant is not dormant', () => {
        expect(keys(computeHealthFlags(healthyInput()))).not.toContain('merchant_dormant');
    });
});

describe('computeHealthFlags — null settings & info flags', () => {
    it('null settings → settings_untouched info, no false ai_disabled', () => {
        const flags = computeHealthFlags(healthyInput({ settings: null }));
        expect(keys(flags)).toContain('settings_untouched');
        expect(keys(flags)).not.toContain('ai_disabled');
        expect(keys(flags)).not.toContain('persona_placeholder');
    });
    it('onboarding_incomplete when onboarding is not finished', () => {
        const flags = computeHealthFlags(healthyInput({
            settings: healthySettings({ onboardingCompletedAt: null }),
        }));
        expect(keys(flags)).toContain('onboarding_incomplete');
    });
});

describe('computeHealthFlags — ordering', () => {
    it('emits red before yellow before info', () => {
        const flags = computeHealthFlags(healthyInput({
            pages: [healthyPage({ disconnected: true, kb: healthyKb({ unresolvedGaps: 3 }) })],
            settings: healthySettings({ holdLowConfidence: true, onboardingCompletedAt: null }),
        }));
        const order = flags.map(f => f.severity);
        const firstYellow = order.indexOf('yellow');
        const firstInfo = order.indexOf('info');
        const lastRed = order.lastIndexOf('red');
        expect(lastRed).toBeLessThan(firstYellow);
        if (firstInfo !== -1) expect(firstYellow).toBeLessThan(firstInfo);
    });
});

describe('isPlaceholderPersona', () => {
    it('empty base and no multi → placeholder', () => {
        expect(isPlaceholderPersona('', {})).toBe(true);
        expect(isPlaceholderPersona(null, null)).toBe(true);
    });
    it('unfilled [template] marker → placeholder', () => {
        expect(isPlaceholderPersona('اسم المتجر هو [Your Store Name]', {})).toBe(true);
    });
    it('real Arabic persona → not placeholder', () => {
        expect(isPlaceholderPersona('نتحدث بلطف ونساعد العميل بسرعة', {})).toBe(false);
    });
    it('empty base but filled multi variant → not placeholder', () => {
        expect(isPlaceholderPersona('', { ar: 'نبرة ودودة ومهنية' })).toBe(false);
    });
    it('placeholder when every non-empty variant is a template', () => {
        expect(isPlaceholderPersona('[name]', { ar: '[الاسم]' })).toBe(true);
    });
});

describe('computeNonDefaultKeys', () => {
    it('a default row has no changed keys', () => {
        expect(computeNonDefaultKeys(healthySettings({ brandVoiceNotes: '' }))).toEqual([]);
    });
    it('null row → []', () => {
        expect(computeNonDefaultKeys(null)).toEqual([]);
    });
    it('flags a flipped boolean', () => {
        expect(computeNonDefaultKeys(healthySettings({ holdLowConfidence: true, brandVoiceNotes: '' })))
            .toEqual(['holdLowConfidence']);
    });
    it('a filled multi jsonb is non-default; empty {} is default', () => {
        expect(computeNonDefaultKeys(healthySettings({ brandVoiceNotes: '', awayMessageMulti: { ar: 'x' } })))
            .toEqual(['awayMessageMulti']);
    });
    it('supportedLanguages is compared order-insensitively', () => {
        expect(computeNonDefaultKeys(healthySettings({ brandVoiceNotes: '', supportedLanguages: ['ar', 'en'] })))
            .toEqual([]);
        expect(computeNonDefaultKeys(healthySettings({ brandVoiceNotes: '', supportedLanguages: ['ar'] })))
            .toEqual(['supportedLanguages']);
    });
    it('a null column value is treated as the default (column default applied)', () => {
        expect(computeNonDefaultKeys(healthySettings({ brandVoiceNotes: '', holdLowConfidence: null })))
            .toEqual([]);
    });
    it('a null array/jsonb column is the default, not "changed"', () => {
        expect(computeNonDefaultKeys(healthySettings({
            brandVoiceNotes: '',
            supportedLanguages: null,
            brandVoiceNotesMulti: null,
            awayMessageMulti: null,
        }))).toEqual([]);
    });
    it('SETTINGS_DEFAULTS covers exactly the console keys', () => {
        expect(Object.keys(SETTINGS_DEFAULTS)).toContain('brandVoiceNotes');
        expect(Object.keys(SETTINGS_DEFAULTS)).toContain('timezone');
    });
});

describe('SETTINGS_DEFAULTS stays in sync with the Drizzle schema', () => {
    // Guards against silent drift: a change to any settings column default (as
    // happened historically with timezone) would flip "changed from default"
    // markers and several health flags with no other failing test.
    for (const key of SUPPORT_SETTINGS_KEYS) {
        it(`${key} matches the schema column default`, () => {
            const col = (settings as unknown as Record<string, { default?: unknown; hasDefault?: boolean }>)[key];
            expect(col, `settings.${key} column missing`).toBeDefined();
            if (key === 'supportedLanguages') {
                // Default is a raw `sql\`ARRAY[...]\`` — its value isn't readable off
                // the SQL object; assert the column HAS a default and the constant
                // holds the intended value.
                expect(col.hasDefault).toBe(true);
                expect(SETTINGS_DEFAULTS.supportedLanguages).toEqual(['en', 'ar']);
                return;
            }
            expect(col.default).toEqual((SETTINGS_DEFAULTS as Record<string, unknown>)[key]);
        });
    }
});

describe('overlayPipelineSettings — effective settings for the console (D-026)', () => {
    // The workspace store exactly as the pipeline reads it for a NEW signup:
    // read-time defaults merged with the D-025 seed — auto-reply OFF on both
    // surfaces, dual comment mode. Real production constants, not copies.
    const newSignupWorkspace = { ...WORKSPACE_DEFAULTS, ...NEW_SIGNUP_SETTINGS_SEED } as unknown as Record<string, unknown>;

    it('a new signup shows the pipeline truth — toggles OFF — not the legacy column defaults (a.tbbaa regression, 2026-08-02)', () => {
        // The raw legacy row reads everything ON (column defaults): exactly what
        // the console wrongly displayed while the reply worker skipped every DM
        // with "Messages auto-reply disabled".
        const effective = overlayPipelineSettings(healthySettings(), newSignupWorkspace);
        expect(effective.commentsAutoReply).toBe(false);
        expect(effective.messagesAutoReply).toBe(false);
        expect(effective.commentReplyMode).toBe('dual');
    });

    it('health flags fire on the effective values: red all_channels_silent for a seeded new signup', () => {
        const effective = overlayPipelineSettings(healthySettings(), newSignupWorkspace);
        const flags = computeHealthFlags(healthyInput({ settings: effective }));
        expect(flags.find(f => f.key === 'all_channels_silent')?.severity).toBe('red');
    });

    it('non-default markers are computed on the effective values', () => {
        const marked = computeNonDefaultKeys(overlayPipelineSettings(healthySettings(), newSignupWorkspace));
        expect(marked).toEqual(expect.arrayContaining(['commentsAutoReply', 'messagesAutoReply', 'commentReplyMode']));
    });

    it('aiModel is NEVER overlaid — the legacy store is authoritative for it (admin override path)', () => {
        const legacy = healthySettings({ aiModel: 'gpt-4.1' });
        const effective = overlayPipelineSettings(legacy, { ...newSignupWorkspace, aiModel: 'gpt-4o-mini' });
        expect(effective.aiModel).toBe('gpt-4.1');
    });

    it('fields the workspace store lacks keep their legacy values (per-field fail-open)', () => {
        const legacy = healthySettings({ replyDelay: 7, timezone: 'Africa/Cairo' });
        const effective = overlayPipelineSettings(legacy, { messagesAutoReply: false });
        expect(effective.replyDelay).toBe(7);
        expect(effective.timezone).toBe('Africa/Cairo');
        expect(effective.messagesAutoReply).toBe(false);
    });

    it('workspace-only pipeline fields never leak into the console payload', () => {
        const effective = overlayPipelineSettings(healthySettings(), {
            ...newSignupWorkspace,
            dualReplyNudgeVariations: { ar: ['رد'] },
            handoffPauseDurationMinutes: 30,
        }) as unknown as Record<string, unknown>;
        expect('dualReplyNudgeVariations' in effective).toBe(false);
        expect('handoffPauseDurationMinutes' in effective).toBe(false);
    });

    it('double-encoded multilingual values from the workspace store are normalized to objects', () => {
        // Drift-heal/backfill can copy a *Multi column verbatim as a JSON string;
        // unnormalized it would corrupt isEmptyRecord / isPlaceholderPersona.
        const effective = overlayPipelineSettings(healthySettings(), {
            ...newSignupWorkspace,
            awayMessageMulti: '{"ar":"نعود قريباً"}',
            brandVoiceNotesMulti: '{"ar":"نتحدث بود ونجيب مباشرة"}',
        });
        expect(effective.awayMessageMulti).toEqual({ ar: 'نعود قريباً' });
        expect(effective.brandVoiceNotesMulti).toEqual({ ar: 'نتحدث بود ونجيب مباشرة' });
        expect(isPlaceholderPersona(null, effective.brandVoiceNotesMulti)).toBe(false);
    });

    it('null multilingual fields on an untouched legacy row stay null when the store has no value', () => {
        const legacy = healthySettings({ greetingMessageMulti: null });
        const effective = overlayPipelineSettings(legacy, { messagesAutoReply: false });
        expect(effective.greetingMessageMulti).toBeNull();
    });

    it('does not mutate the legacy row', () => {
        const legacy = healthySettings();
        overlayPipelineSettings(legacy, newSignupWorkspace);
        expect(legacy.messagesAutoReply).toBe(true);
        expect(legacy.commentReplyMode).toBe('public');
    });

    it('a double-encoded multi in the LEGACY row is normalized too, even when the store has no value for it', () => {
        // Same corruption class as the workspace-side case, but originating in
        // the legacy table itself — the coercion must not depend on an overlay
        // having replaced the field.
        const legacy = healthySettings({
            awayMessageMulti: '{"ar":"نعود قريباً"}' as unknown as Record<string, string>,
        });
        const effective = overlayPipelineSettings(legacy, { messagesAutoReply: false });
        expect(effective.awayMessageMulti).toEqual({ ar: 'نعود قريباً' });
    });
});

describe('resolvePipelineWorkspaceId — which workspace the pipeline actually obeys', () => {
    const OWNED = 'ws-owned';
    const OTHER = 'ws-other';
    const memberships = [
        { workspaceId: OTHER, ownerId: 'someone-else' },
        { workspaceId: OWNED, ownerId: 'me' },
    ];

    it('the displayed pages’ workspace wins over memberships — the pipeline keys on page.workspaceId (page-transfer case)', () => {
        expect(resolvePipelineWorkspaceId(['ws-pages'], memberships, 'me')).toBe('ws-pages');
    });

    it('pages split across workspaces → the one covering the most displayed pages', () => {
        expect(resolvePipelineWorkspaceId(['ws-a', 'ws-b', 'ws-b'], memberships, 'me')).toBe('ws-b');
    });

    it('a page-count tie prefers the workspace this user owns', () => {
        expect(resolvePipelineWorkspaceId([OTHER, OWNED], memberships, 'me')).toBe(OWNED);
    });

    it('no pages → the owned membership, even when a foreign membership sorts first', () => {
        expect(resolvePipelineWorkspaceId([], memberships, 'me')).toBe(OWNED);
    });

    it('team-member-only (no pages, no owned workspace) → the first membership', () => {
        expect(resolvePipelineWorkspaceId([], [{ workspaceId: OTHER, ownerId: 'someone-else' }], 'me')).toBe(OTHER);
    });

    it('pages with null workspaceId are ignored; nothing at all → undefined', () => {
        expect(resolvePipelineWorkspaceId([null], memberships, 'me')).toBe(OWNED);
        expect(resolvePipelineWorkspaceId([null], [], 'me')).toBeUndefined();
    });
});

describe('computeHealthFlags — the gate says WHY (blockCause)', () => {
    it('labels a lazily-flipped expired trial as trial_expired, not subscription_inactive', () => {
        // The row prod actually holds for an expired trial: status already
        // flipped to past_due by getUserSubscription, trialEndsAt in the past.
        // The status heuristic alone calls this "subscription inactive — DB
        // status: past due", i.e. a customer whose subscription lapsed. 19 of
        // the 20 past_due rows on prod (2026-08-22) were this shape, and none
        // of them had ever subscribed.
        const flags = computeHealthFlags(healthyInput({
            subscription: {
                status: 'past_due',
                trialEndsAt: new Date('2026-07-20T00:00:00Z'),
                autoReplyAllowed: false,
                blockCause: 'trial_expired',
                entitlementEndsAt: new Date('2026-07-20T00:00:00Z'),
            },
        }));
        expect(keys(flags)).toContain('trial_expired');
        expect(keys(flags)).not.toContain('subscription_inactive');
    });

    it('still falls back to the status heuristic when the caller predates blockCause', () => {
        const flags = computeHealthFlags(healthyInput({
            subscription: { status: 'trialing', trialEndsAt: new Date('2026-07-20T00:00:00Z'), autoReplyAllowed: false, entitlementEndsAt: null },
        }));
        expect(keys(flags)).toContain('trial_expired');
    });
});
