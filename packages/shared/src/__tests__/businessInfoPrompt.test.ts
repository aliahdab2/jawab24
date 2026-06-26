import { describe, it, expect } from 'vitest';
import { formatBusinessInfoPrompt } from '../businessInfoPrompt';
import type { BusinessProfile } from '../index';
import type { MerchantProvenanceMap } from '../businessProfileMerge';

// Regression guard for the BUSINESS_INFO prompt block. Locks in current
// formatter contract so the Option B refactor (auto-promoting FB suggestions
// into merchant with provenance) cannot silently break the prompt's
// anti-hallucination wording, the [NOT_PROVIDED] markers, or the
// null-on-empty behavior that saves prompt tokens.
describe('formatBusinessInfoPrompt', () => {
    describe('null / empty input', () => {
        it('returns null for null profile (no block injected)', () => {
            expect(formatBusinessInfoPrompt(null)).toBeNull();
        });

        it('returns null for undefined', () => {
            expect(formatBusinessInfoPrompt(undefined)).toBeNull();
        });

        it('returns null for empty object — no signal to add', () => {
            expect(formatBusinessInfoPrompt({})).toBeNull();
        });

        it('returns null when only language_hint is set (no signal fields)', () => {
            expect(formatBusinessInfoPrompt({ language_hint: 'ar' })).toBeNull();
        });
    });

    describe('populated profile', () => {
        it('emits the structured block header', () => {
            const block = formatBusinessInfoPrompt({ address: 'Damascus' });
            expect(block).toContain('BUSINESS_INFO');
            expect(block).toContain('structured, authoritative');
        });

        it('includes the anti-hallucination refusal directive at the TOP (must survive truncation)', () => {
            const block = formatBusinessInfoPrompt({ address: 'Damascus' });
            expect(block).not.toBeNull();
            const lines = block!.split('\n');
            // Directive must appear in the first three lines so the
            // BUSINESS_INFO_MAX_CHARS cap can't strip it for rich profiles.
            const directiveSlice = lines.slice(0, 3).join(' ');
            expect(directiveSlice).toContain('MUST NOT invent');
        });

        it('renders address verbatim', () => {
            const block = formatBusinessInfoPrompt({
                address: 'البرامكة سانا فوق مكتبة الحافظ',
            });
            expect(block).toContain('البرامكة سانا فوق مكتبة الحافظ');
        });

        it('joins address + city + country with commas', () => {
            const block = formatBusinessInfoPrompt({
                address: 'Baramkeh',
                city: 'Damascus',
                country: 'Syria',
            });
            expect(block).toContain('Baramkeh, Damascus, Syria');
        });

        it('renders phones as comma-joined list', () => {
            const block = formatBusinessInfoPrompt({
                phones: ['+963937549674', '0112124472'],
            });
            expect(block).toContain('+963937549674, 0112124472');
        });

        it('falls back to legacy `phone` when `phones` is missing', () => {
            const block = formatBusinessInfoPrompt({
                phone: '0935924472',
            } as BusinessProfile);
            expect(block).toContain('0935924472');
        });

        it('marks missing fields as [NOT_PROVIDED] (anti-hallucination)', () => {
            const block = formatBusinessInfoPrompt({
                address: 'Damascus',
                // phones, hours, policies all missing
            });
            expect(block).toContain('Phones: [NOT_PROVIDED]');
            expect(block).toContain('Hours: [NOT_PROVIDED]');
            expect(block).toContain('Policies: [NOT_PROVIDED]');
        });

        it('renders hours in day order, not insertion order', () => {
            const block = formatBusinessInfoPrompt({
                hours: {
                    fri: ['closed'],
                    mon: ['09:00-17:00'],
                    sun: ['10:00-14:00'],
                },
            });
            expect(block).not.toBeNull();
            const mondayIdx = block!.indexOf('Monday');
            const fridayIdx = block!.indexOf('Friday');
            const sundayIdx = block!.indexOf('Sunday');
            expect(mondayIdx).toBeGreaterThan(-1);
            expect(mondayIdx).toBeLessThan(fridayIdx);
            expect(fridayIdx).toBeLessThan(sundayIdx);
        });
    });

    describe('the exact prod failure case (the "عنوان" regression)', () => {
        // The merchant in question (page 39aeab89) has rich data in
        // `suggestions` but `merchant: {}`. This pins the contract:
        // when merchant is empty, the block must be null — i.e. the
        // current behavior is correct in isolation; the bug lives in
        // the caller path that fails to promote suggestions → merchant.
        // After Option B lands, the caller will pass a populated merchant
        // here and this same test will keep passing.
        it('returns null for an empty merchant (locks in the gate)', () => {
            expect(formatBusinessInfoPrompt({})).toBeNull();
        });

        it('renders a populated merchant when NO provenance map is supplied (legacy default = authoritative)', () => {
            // No provenance → every field is treated as merchant-authored
            // (legacy rows predating Option B could only have been editor
            // writes). This is the back-compat path for preview / legacy callers.
            const promoted: BusinessProfile = {
                address: 'البرامكة سانا فوق مكتبة الحافظ الطابق الاول, Damascus, Syria',
                phones: ['+963937549674'],
                hours: {
                    mon: ['08:00-20:00'],
                    tue: ['08:00-20:00'],
                    wed: ['08:00-20:00'],
                    thu: ['08:00-20:00'],
                    fri: ['00:00-23:45'],
                    sat: ['08:00-20:00'],
                    sun: ['08:00-20:00'],
                },
            };
            const block = formatBusinessInfoPrompt(promoted);
            expect(block).not.toBeNull();
            expect(block).toContain('البرامكة سانا');
            expect(block).toContain('+963937549674');
            expect(block).toContain('Monday: 08:00-20:00');
        });
    });

    // The reported production bug: a merchant typed their real hours/phone into
    // their KB (Business Info), but the AI replied with Facebook's values
    // because the authoritative block was built from UNCONFIRMED FB-sync data.
    // Provenance gating demotes fb_sync fields to the narrative fallback so
    // the KB text governs. Contract: editor/kb_extract = authoritative;
    // fb_sync = omitted (fallback); genuinely-absent = [NOT_PROVIDED].
    describe('provenance gating ("KB wins, Facebook is fallback")', () => {
        const fbSync = (...fields: (keyof BusinessProfile)[]): MerchantProvenanceMap =>
            Object.fromEntries(fields.map(f => [f, { source: 'fb_sync', confirmedAt: null }]));
        const editor = (...fields: (keyof BusinessProfile)[]): MerchantProvenanceMap =>
            Object.fromEntries(fields.map(f => [f, { source: 'editor', confirmedAt: '2026-06-26T00:00:00.000Z' }]));

        it('OMITS an fb_sync phone — never asserts it as authoritative over KB', () => {
            const block = formatBusinessInfoPrompt(
                { phones: ['+963937549674'], address: 'Damascus' },
                fbSync('phones', 'address'),
            );
            // Both fields are FB-only → both omitted. No authoritative anchor,
            // and nothing genuinely absent among the populated fields, but hours
            // & policies are absent → guarded. The FB phone must NOT appear.
            expect(block).not.toContain('+963937549674');
            expect(block).not.toContain('Damascus');
        });

        it('returns null when EVERY field is fb_sync (no authoritative signal → FB via fallback)', () => {
            const block = formatBusinessInfoPrompt(
                {
                    address: 'Damascus',
                    phones: ['+963937549674'],
                    hours: { mon: ['09:00-17:00'] },
                    policies: { shipping: 'we ship nationwide' },
                },
                fbSync('address', 'city', 'country', 'phones', 'hours', 'policies'),
            );
            expect(block).toBeNull();
        });

        it('asserts an editor-authored value over fb_sync', () => {
            const block = formatBusinessInfoPrompt(
                { phones: ['0935924472'], hours: { mon: ['10:00-18:00'] } },
                { ...editor('hours'), ...fbSync('phones') },
            );
            expect(block).not.toBeNull();
            // editor hours → authoritative, shown.
            expect(block).toContain('Monday: 10:00-18:00');
            // fb_sync phone → omitted (fallback), NOT shown as a value...
            expect(block).not.toContain('0935924472');
            // ...and NOT marked [NOT_PROVIDED] either (it exists, just at fallback).
            expect(block).not.toContain('Phones: [NOT_PROVIDED]');
        });

        it('treats kb_extract as authoritative (merchant authored it in their KB)', () => {
            const block = formatBusinessInfoPrompt(
                { hours: { fri: ['closed'], sat: ['09:00-17:00'] } },
                { hours: { source: 'kb_extract', confirmedAt: null } },
            );
            expect(block).not.toBeNull();
            expect(block).toContain('Friday: closed');
            expect(block).toContain('Saturday: 09:00-17:00');
        });

        // PROD BUG (page 39aeab89 "الفريق الدمشقي للتدريب والتأهيل", 2026-06-26):
        // a customer asked working hours; the bot answered "08:00-20:00, Friday
        // 00:00-23:45 (open ~24h)" — Facebook's values — even though the KB plainly
        // says "كل ايام الاسبوع من الساعة ٩ صباحا الى الساعة ٨ مساء ماعدا يوم الجمعة"
        // (9am-8pm, CLOSED Friday). On prod, `merchant` is byte-identical to the
        // `suggestions` (FB) half — Friday 00:00-23:45 = Facebook's "open all day"
        // encoding — yet EVERY field's provenance is {source:'editor',confirmedAt:null}.
        // A genuine editor save ALWAYS stamps confirmedAt (applyMerchantEdit: "saving
        // IS confirming"), so editor+confirmedAt:null is a state a real edit can NEVER
        // produce — it is only ever set by normalizeLegacyProvenance, which wrongly
        // assumed pre-split merchant data was editor-typed. #351's gate trusts any
        // non-fb_sync source, so it does NOT demote these → the FB hours reach the
        // authoritative block and override the KB. An UNCONFIRMED value must never
        // override the merchant's own KB text, whatever source label it carries.
        it('OMITS editor-provenance hours that were never confirmed (confirmedAt:null) — legacy FB data mislabeled editor must not override KB', () => {
            const block = formatBusinessInfoPrompt(
                {
                    hours: {
                        mon: ['08:00-20:00'], tue: ['08:00-20:00'], wed: ['08:00-20:00'],
                        thu: ['08:00-20:00'], fri: ['00:00-23:45'], sat: ['08:00-20:00'],
                        sun: ['08:00-20:00'],
                    },
                    phones: ['+963937549674'],
                },
                {
                    hours: { source: 'editor', confirmedAt: null },
                    phones: { source: 'editor', confirmedAt: null },
                },
            );
            // The FB hours must NOT be asserted as authoritative (they'd override the KB).
            expect(block).not.toContain('08:00-20:00');
            expect(block).not.toContain('00:00-23:45');
            // The unconfirmed phone is demoted to the narrative fallback too — not asserted.
            expect(block).not.toContain('+963937549674');
        });

        it('KEEPS editor hours when confirmedAt is set (a real merchant edit DOES override KB)', () => {
            // The mirror of the case above: once the merchant opens the editor and
            // saves (confirmedAt set), their structured hours ARE authoritative again.
            const block = formatBusinessInfoPrompt(
                { hours: { fri: ['closed'], sat: ['09:00-17:00'] } },
                { hours: { source: 'editor', confirmedAt: '2026-06-26T12:00:00.000Z' } },
            );
            expect(block).not.toBeNull();
            expect(block).toContain('Friday: closed');
            expect(block).toContain('Saturday: 09:00-17:00');
        });

        it('preserves the [NOT_PROVIDED] phone guard (#11) for an FB-only merchant with NO phone', () => {
            // FB gave address + hours but no phone. The block must still inject
            // so the phone guard fires — otherwise the Damascus "1234567"
            // hallucination returns. The fb_sync address/hours are omitted.
            const block = formatBusinessInfoPrompt(
                { address: 'Damascus', hours: { mon: ['09:00-17:00'] } },
                fbSync('address', 'hours'),
            );
            expect(block).not.toBeNull();
            expect(block).toContain('Phones: [NOT_PROVIDED]');
            // The fb_sync fields are demoted to fallback, not asserted here.
            expect(block).not.toContain('Damascus');
            expect(block).not.toContain('Monday: 09:00-17:00');
        });

        it('gates address components independently (editor city kept, fb_sync country dropped)', () => {
            const block = formatBusinessInfoPrompt(
                { address: 'Baramkeh', city: 'Damascus', country: 'Syria' },
                { ...editor('address', 'city'), ...fbSync('country') },
            );
            expect(block).not.toBeNull();
            expect(block).toContain('Baramkeh, Damascus');
            expect(block).not.toContain('Syria');
        });
    });
});
