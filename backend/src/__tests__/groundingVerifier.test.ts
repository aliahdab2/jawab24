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
    shouldVerifyGrounding, buildGroundingSource, buildVerifierUserMessage, GROUNDING_FLAG, GROUNDING_SHADOW_META_KEY,
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
            businessInfoBlock: 'BUSINESS INFO TEXT',
        });
        expect(out).toContain('KB TEXT');
        expect(out).toContain('POST TEXT');
        expect(out).toContain('POLICY TEXT');
        expect(out).toContain('CATALOG TEXT');
        expect(out).toContain('LISTS TEXT');
        expect(out).toContain('BUSINESS INFO TEXT');
    });

    // The regression this test exists for (prod, 2026-08-04): a merchant moved his
    // address OUT of the KB free text and into the confirmed address field. The
    // field reaches the model through its own block, never through knowledgeBase —
    // so the verifier stopped seeing it and flagged his own address as invented on
    // 17 of his next 66 replies. Any reply quoting a confirmed field must be
    // grounded by that field alone, with no KB text present at all.
    it('includes the business-info block, so a reply quoting a confirmed field is grounded', () => {
        // The failing shape exactly: the address lives ONLY in the confirmed field,
        // and the KB prose no longer mentions it.
        const businessInfoBlock = [
            'معلومات النشاط التجاري المؤكدة:',
            'العنوان: برامكة، فوق مكتبة الحافظ، الطابق الأول — جنب الهجرة والجوازات وجامع الرازي، دمشق',
            'ساعات العمل: من السبت إلى الخميس 09:00 - 17:00',
        ].join('\n');
        const knowledgeBase = 'دورات تدريبية متنوعة. '.repeat(20);
        expect(knowledgeBase).not.toContain('جامع الرازي');

        const out = buildGroundingSource({ knowledgeBase, businessInfoBlock });
        expect(out).toContain('جامع الرازي');
        expect(shouldVerifyGrounding(base({ kb: out }))).toBe(true);
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


    // The floor MIN_KB_CHARS exists to skip pages "running on persona alone" —
    // its own words. Folding the persona into this function would let it satisfy
    // the very floor written to exclude it: measured 2026-08-19, 6 of 38 live
    // pages sit under the floor on Business Info yet clear it once the persona is
    // counted, so every claim on exactly the starved pages the floor protects
    // would flag. The persona grounds from its own section instead.
    it('leaves the persona out, so it cannot satisfy the MIN_KB_CHARS floor', () => {
        const thinBusinessInfo = 'صالة عرض.';
        const fatPersona = 'الاسم: معك رنيم من شركة ام اي اس. '.repeat(20);
        expect(fatPersona.length).toBeGreaterThan(200);

        const out = buildGroundingSource({ knowledgeBase: thinBusinessInfo });
        expect(out).not.toContain('رنيم');
        expect(shouldVerifyGrounding(base({ kb: out }))).toBe(false);
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

describe('buildVerifierUserMessage', () => {
    const msg = (persona?: string) => buildVerifierUserMessage({
        kb: 'BUSINESS INFO',
        persona,
        question: 'Q',
        reply: 'R',
    });

    // The regression this test exists for (prod, 2026-08-19): ام. اي. اس wrote
    // «الاسم: معك رنيم من شركة ام اي اس» in the persona. The reply obeyed and
    // opened with «معك رنيم» — and the verifier, which received five blocks and
    // not that sentence, reported the merchant's own assistant name as an
    // invented employee. Verified against prod that «رنيم» appears in NONE of
    // kb_chunks / knowledge_base / business_profile for that page, so the
    // persona is the only place it can be grounded.
    it('includes the persona, so a reply using the merchant-chosen assistant name is grounded', () => {
        const knowledgeBase = 'شاشات وبرادات وغسالات بأسعار منافسة. '.repeat(20);
        expect(knowledgeBase).not.toContain('رنيم');

        const out = buildVerifierUserMessage({
            kb: knowledgeBase,
            persona: 'الاسم: معك رنيم من شركة ام اي اس\nالنبرة واللهجة: ودود، لهجة سورية',
            question: 'انت شو اسمك',
            reply: 'معك رنيم من ام. اي. اس، كيف فيني ساعدك؟',
        });
        expect(out).toContain('رنيم');
        expect(out).toContain('<merchant_instructions>');
    });

    // Why the WHOLE block goes in rather than just the persona's name: merchants
    // put policy in this field. Both strings below are live prod values from
    // منتجع شاهين. Passing identity alone would leave every policy answer —
    // "no booking over social", "no Sham Cash" — ungrounded, which is the same
    // false-flag class one field further along.
    it('grounds a policy the merchant wrote in the persona field, not just the name', () => {
        const knowledgeBase = 'منتجع سياحي على البحر مع أجنحة وشقق فندقية. '.repeat(20);
        const brandVoiceNotes = [
            'سارة , لهجة سورية ودودة , لاتقوم باعطاء أجوبة خارج نطاق المنتجع',
            'لايوجد لدينا تثبيت حجز عن طريق وسائل التواصل الاجتماعي',
            'حاليا لايوجد دفع عن طريق شام كاش',
        ].join('\n');
        expect(knowledgeBase).not.toContain('شام كاش');

        const out = buildVerifierUserMessage({ kb: knowledgeBase, persona: brandVoiceNotes, question: 'بتقبلوا شام كاش؟', reply: 'حالياً ما في دفع عن طريق شام كاش.' });
        expect(out).toContain('شام كاش');
        expect(out).toContain('تثبيت حجز عن طريق وسائل التواصل');
    });


    // An absent persona must not leave an empty tag behind — a bare
    // <merchant_instructions></merchant_instructions> reads to the auditor as
    // "the merchant wrote nothing", which is a claim the payload should not make.
    it('omits the section entirely when there is no persona', () => {
        expect(msg()).not.toContain('merchant_instructions');
        expect(msg('   ')).not.toContain('merchant_instructions');
        expect(msg('الاسم: سارة')).toContain('<merchant_instructions>');
    });

    // Ordering is a cost property, not cosmetics: <business_info> and the
    // page-stable persona are the two largest spans and both are byte-identical
    // across a page's replies, so they must precede the per-reply text for
    // OpenAI's prompt cache to hit.
    it('keeps business_info first and the persona directly behind it', () => {
        const out = buildVerifierUserMessage({
            kb: 'BUSINESS INFO', persona: 'الاسم: سارة',
            conversation: 'customer: hi', question: 'Q', reply: 'R',
        });
        expect(out.indexOf('<business_info>')).toBeLessThan(out.indexOf('<merchant_instructions>'));
        expect(out.indexOf('<merchant_instructions>')).toBeLessThan(out.indexOf('<conversation>'));
        expect(out.indexOf('<conversation>')).toBeLessThan(out.indexOf('<customer_message>'));
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
