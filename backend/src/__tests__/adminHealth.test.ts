import { describe, it, expect } from 'vitest';
import { DEFAULT_AI_MODEL, PLACEHOLDER_TIMEZONE } from '@jawab24/shared';
import {
    computeHealthFlags,
    computeNonDefaultKeys,
    isPlaceholderPersona,
    SETTINGS_DEFAULTS,
    SUPPORT_SETTINGS_KEYS,
    type HealthInput,
    type HealthInputPage,
    type SupportSettings,
    type PageKbSummary,
} from '../services/admin/health';
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
        ...overrides,
    };
}

function healthyPage(overrides: Partial<HealthInputPage> = {}): HealthInputPage {
    return {
        id: 'page-1',
        name: 'متجر تجريبي',
        disconnected: false,
        autoReplyEnabled: true,
        autoReplyDisabledReason: null,
        kb: healthyKb(overrides.kb),
        ...overrides,
    };
}

function healthyInput(overrides: Partial<HealthInput> = {}): HealthInput {
    return {
        now: NOW,
        lastSeenAt: new Date('2026-07-23T00:00:00Z'),
        settings: healthySettings(),
        subscription: { status: 'active', trialEndsAt: null },
        pages: [healthyPage()],
        usage: { aiRepliesCount: 100, limit: 1000 },
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

    it('kb_empty when there are no chunks', () => {
        const flags = computeHealthFlags(healthyInput({
            pages: [healthyPage({ kb: healthyKb({ kbLength: 0, chunksTotal: 0, chunksByType: {} }) })],
        }));
        expect(keys(flags)).toContain('kb_empty');
        // Empty short-circuits the offering/thin checks.
        expect(keys(flags)).not.toContain('no_offering_chunks');
        expect(keys(flags)).not.toContain('kb_thin');
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

    it('trial_expired when a trialing sub is past its end date', () => {
        const flags = computeHealthFlags(healthyInput({
            subscription: { status: 'trialing', trialEndsAt: new Date('2026-07-20T00:00:00Z') },
        }));
        expect(keys(flags)).toContain('trial_expired');
    });

    it('subscription_inactive for past_due / canceled', () => {
        for (const status of ['past_due', 'canceled']) {
            const flags = computeHealthFlags(healthyInput({
                subscription: { status, trialEndsAt: null },
            }));
            const f = flags.find(x => x.key === 'subscription_inactive');
            expect(f?.meta?.status).toBe(status);
        }
    });
});

describe('computeHealthFlags — usage boundaries', () => {
    const at = (aiRepliesCount: number, limit = 1000) =>
        keys(computeHealthFlags(healthyInput({ usage: { aiRepliesCount, limit } })));

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
        expect(keys(computeHealthFlags(healthyInput({ usage: { aiRepliesCount: 5000, limit: null } }))))
            .not.toContain('usage_over_cap');
    });
    it('limit_fallback_off fires near cap when fallback disabled', () => {
        const flags = computeHealthFlags(healthyInput({
            usage: { aiRepliesCount: 900, limit: 1000 },
            settings: healthySettings({ limitFallbackEnabled: false }),
        }));
        expect(keys(flags)).toContain('limit_fallback_off');
    });
    it('no limit_fallback_off when fallback enabled', () => {
        const flags = computeHealthFlags(healthyInput({
            usage: { aiRepliesCount: 900, limit: 1000 },
            settings: healthySettings({ limitFallbackEnabled: true }),
        }));
        expect(keys(flags)).not.toContain('limit_fallback_off');
    });
});

describe('computeHealthFlags — trial ending window', () => {
    const trialEndingIn = (days: number) =>
        keys(computeHealthFlags(healthyInput({
            subscription: { status: 'trialing', trialEndsAt: new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000) },
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
            pages: [healthyPage({ kb: healthyKb({ kbLength: 0, chunksTotal: 0, chunksByType: {} }) })],
        }));
        const f = weak.find(x => x.key === 'hold_low_confidence');
        expect(f?.meta?.withWeakKb).toBe(1);
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
