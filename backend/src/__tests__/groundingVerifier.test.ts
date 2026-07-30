import { describe, it, expect, vi } from 'vitest';

// The gate is the only part of the verifier worth unit-testing: every other
// branch is an OpenAI call or a DB write. Mock the module's heavy imports so
// loading it here doesn't pull in the db/redis graph.
vi.mock('../config', () => ({
    config: { openai: { apiKey: 'test-key' }, groundingVerify: { enabled: true, pageIds: [], mode: 'shadow' } },
}));
vi.mock('../db', () => ({ db: {} }));
vi.mock('../services/aiUsageLog', () => ({ logAiUsage: vi.fn() }));
vi.mock('../lib/aiMetrics', () => ({
    recordAiAttempt: vi.fn(), recordAiReturn: vi.fn(), recordAiFailedBeforeLog: vi.fn(),
}));

import {
    shouldVerifyGrounding, buildGroundingSource, GROUNDING_FLAG, GROUNDING_SHADOW_META_KEY,
} from '../services/groundingVerifier';

const KB = 'k'.repeat(400);
const REPLY = 'ر'.repeat(120);

/** A reply that SHOULD be verified — each test flips exactly one field. */
const base = (over: Partial<Parameters<typeof shouldVerifyGrounding>[0]> = {}) => ({
    pageId: 'page-under-test',
    replyMethod: 'ai',
    intent: 'QUESTION',
    reply: REPLY,
    kb: KB,
    ...over,
});

describe('shouldVerifyGrounding', () => {
    it('verifies a substantive AI reply on a page with real Business Info', () => {
        expect(shouldVerifyGrounding(base())).toBe(true);
    });

    // Templates (away/greeting/fallback) and human replies are merchant-authored
    // by definition — there is nothing there that could have been hallucinated,
    // and verifying them would bill the merchant for auditing their own words.
    it.each(['template', 'manual', 'post_reply', null, undefined])(
        'skips replyMethod=%s — only AI-authored text can fabricate',
        (replyMethod) => {
            expect(shouldVerifyGrounding(base({ replyMethod }))).toBe(false);
        },
    );

    // 22.5% of prod AI replies, averaging 53-61 characters. They assert nothing,
    // so every call spent on them is pure cost.
    it.each(['GREETING', 'COMPLIMENT', 'OFFENSIVE', 'SPAM_OR_IRRELEVANT'])(
        'skips the non-assertive intent %s',
        (intent) => {
            expect(shouldVerifyGrounding(base({ intent }))).toBe(false);
        },
    );

    it.each(['QUESTION', 'PURCHASE_INTENT', 'BUSINESS_INQUIRY', 'COMPLAINT', null])(
        'verifies the claim-bearing intent %s',
        (intent) => {
            expect(shouldVerifyGrounding(base({ intent }))).toBe(true);
        },
    );

    // A cached reply was verified when it was first generated; re-verifying it
    // pays again for a verdict already on the row it was cached from.
    it('skips a reply served from the reply cache', () => {
        expect(shouldVerifyGrounding(base({ fromCache: true }))).toBe(false);
    });

    it('skips replies shorter than the 80-character floor', () => {
        expect(shouldVerifyGrounding(base({ reply: 'تمام 👍' }))).toBe(false);
        expect(shouldVerifyGrounding(base({ reply: 'x'.repeat(79) }))).toBe(false);
        expect(shouldVerifyGrounding(base({ reply: 'x'.repeat(80) }))).toBe(true);
    });

    it.each([null, undefined, '', 'too short to ground anything'])(
        'skips a page whose Business Info is missing or trivial (%s)',
        (kb) => {
            expect(shouldVerifyGrounding(base({ kb }))).toBe(false);
        },
    );

    it('skips an empty reply without throwing', () => {
        expect(shouldVerifyGrounding(base({ reply: '' }))).toBe(false);
        expect(shouldVerifyGrounding(base({ reply: null }))).toBe(false);
    });
});

describe('shouldVerifyGrounding — feature flag', () => {
    // The switch is the rollback: with GROUNDING_VERIFY_ENABLED unset, the call
    // sites in messageProcessor/commentProcessor must be completely inert, so
    // deploying this code changes nothing until it is turned on deliberately.
    it('verifies nothing while the feature flag is off', async () => {
        vi.resetModules();
        vi.doMock('../config', () => ({
            config: { openai: { apiKey: 'test-key' }, groundingVerify: { enabled: false, pageIds: [], mode: 'shadow' } },
        }));
        const { shouldVerifyGrounding: gated } = await import('../services/groundingVerifier');
        expect(gated(base())).toBe(false);
        vi.doUnmock('../config');
        vi.resetModules();
    });

    // The pilot runs on ONE merchant. A page allowlist is what keeps a
    // measurement from becoming a fleet-wide rollout by accident — and it is
    // also the rollback that doesn't need a deploy.
    it('verifies only the allowlisted page when an allowlist is set', async () => {
        vi.resetModules();
        vi.doMock('../config', () => ({
            config: {
                openai: { apiKey: 'test-key' },
                groundingVerify: { enabled: true, pageIds: ['bambo-page-id'], mode: 'shadow' },
            },
        }));
        const { shouldVerifyGrounding: piloted } = await import('../services/groundingVerifier');
        expect(piloted(base({ pageId: 'bambo-page-id' }))).toBe(true);
        expect(piloted(base({ pageId: 'some-other-page' }))).toBe(false);
        vi.doUnmock('../config');
        vi.resetModules();
    });
});

describe('buildGroundingSource', () => {
    // The verifier judges against this text, so anything the generator saw and
    // this omits becomes a false "unsupported" — a store policy dropped here
    // would make every policy answer look invented.
    it('includes every context block the generator receives', () => {
        const out = buildGroundingSource({
            knowledgeBase: 'KB TEXT',
            postMessage: 'POST TEXT',
            storePolicies: 'POLICY TEXT',
            productCatalog: 'CATALOG TEXT',
            factCollectionsBlock: 'LISTS TEXT',
        });
        expect(out).toContain('KB TEXT');
        expect(out).toContain('POST TEXT');
        expect(out).toContain('POLICY TEXT');
        expect(out).toContain('CATALOG TEXT');
        expect(out).toContain('LISTS TEXT');
    });

    // G1a: the <business_lists> block is exactly where the pages this verifier
    // watches keep their outlets and coverage areas. Omitting it would flag every
    // CORRECT outlet answer as invented — the fix producing the defect it measures.
    it('includes the fact-collections block, so a correctly-quoted outlet is grounded', () => {
        // A directory-shaped block: comfortably over MIN_KB_CHARS, as a real one is
        // (BAMBO's is ~9.5k chars). Pins that a page whose business facts live
        // ENTIRELY in collections — no KB prose at all, which is where the engine is
        // heading — still passes the gate and still counts its outlets as sources.
        const outlets = Array.from({ length: 12 }, (_, i) => `- صيدلية رقم ${i} — المنطقة: تلة الريح`).join('\n');
        const listsOnly = buildGroundingSource({
            factCollectionsBlock: `صيدليات المدينة:\n${outlets}\n- صيدلية الفيروز — المنطقة: تلة الريح`,
        });
        expect(listsOnly).toContain('صيدلية الفيروز');
        expect(listsOnly.length).toBeGreaterThan(200);
        expect(shouldVerifyGrounding(base({ kb: listsOnly }))).toBe(true);
    });

    it('drops absent and whitespace-only blocks instead of padding the source', () => {
        expect(buildGroundingSource({ knowledgeBase: 'KB', storePolicies: '   ', productCatalog: null }))
            .toBe('KB');
        expect(buildGroundingSource({})).toBe('');
    });

    // An empty source must fail the gate rather than reach the model, where
    // every claim in the reply would flag as unsupported.
    it('produces a source that the gate rejects when nothing is available', () => {
        expect(shouldVerifyGrounding(base({ kb: buildGroundingSource({}) }))).toBe(false);
    });
});

describe('shadow mode', () => {
    // Owner ruling 2026-07-28: no merchant contact — including via the UI —
    // until a real fix exists. A new flag chip appearing in Needs Attention IS
    // contact, so the default mode must write somewhere no merchant can see.
    it('uses a meta key that is NOT a flag_reason value, so nothing renders it', async () => {
        expect(GROUNDING_SHADOW_META_KEY).toBe('reply_not_grounded_shadow');
        expect(GROUNDING_SHADOW_META_KEY).not.toBe(GROUNDING_FLAG);
        const { flagReasonEn } = await import('@jawab24/shared');
        // The visible flag has a label; the shadow key deliberately does not —
        // an unlabelled key cannot show up as a chip.
        expect(flagReasonEn).toHaveProperty(GROUNDING_FLAG);
        expect(flagReasonEn).not.toHaveProperty(GROUNDING_SHADOW_META_KEY);
    });
});

describe('GROUNDING_FLAG', () => {
    // The flag string is a cross-package contract: cacheQualityGate blocks
    // caching on it and the frontend resolves its label from the flagReason
    // i18n namespace under this exact key.
    it('is the key the cache gate and the i18n label are registered under', async () => {
        expect(GROUNDING_FLAG).toBe('reply_not_grounded');
        const { flagReasonEn, flagReasonAr } = await import('@jawab24/shared');
        expect(flagReasonEn).toHaveProperty(GROUNDING_FLAG);
        expect(flagReasonAr).toHaveProperty(GROUNDING_FLAG);
    });
});
