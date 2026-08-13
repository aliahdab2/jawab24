import { describe, it, expect } from 'vitest';
import { formatBusinessInfoPrompt, businessPhoneEntries, businessPhoneList } from '../businessInfoPrompt';
import { MAX_PHONE_DESCRIPTION_LENGTH } from '../businessPhone';
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
            expect(block).toContain('merchant-confirmed');
        });

        it('states the conflict rule explicitly — a bare "prefer" did not survive a real disagreement', () => {
            // v57: eval #720 put a merchant-confirmed address here and a stale one
            // in the KB narrative; with the old "prefer over <business_knowledge>"
            // wording the model answered from the KB. The block must now SAY which
            // side is correct when they disagree.
            const block = formatBusinessInfoPrompt({ address: 'Damascus' });
            expect(block).toContain('<business_knowledge>');
            expect(block).toContain('the correct one');
            expect(block).toContain('outdated');
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
            expect(block).toContain('- Phones / الهاتف / الأرقام: [NOT_PROVIDED]');
            expect(block).toContain('- Hours / أوقات الدوام: [NOT_PROVIDED]');
            expect(block).toContain('- Policies / السياسات: [NOT_PROVIDED]');
        });

        // v61. `channels.whatsapp` existed on the type since Stage 2.6 but was
        // read by nothing — B1 gives it a fact row, so it has to reach the model.
        it('renders the merchant WhatsApp contact when set', () => {
            const block = formatBusinessInfoPrompt({
                address: 'Damascus',
                channels: { whatsapp: '+963937549674' },
            });
            expect(block).toContain('- WhatsApp / واتساب: +963937549674');
        });

        // The /business editor stores an ARRAY since any listed number can be
        // on WhatsApp independently; legacy rows still hold a single string.
        it('renders every WhatsApp number from array storage', () => {
            const block = formatBusinessInfoPrompt({
                address: 'Damascus',
                channels: { whatsapp: ['+963937549674', '+963911111111'] },
            });
            expect(block).toContain('- WhatsApp / واتساب: +963937549674, +963911111111');
        });

        it('treats an array of blank entries as unset', () => {
            const block = formatBusinessInfoPrompt({
                address: 'Damascus',
                channels: { whatsapp: ['  ', ''] },
            });
            expect(block).not.toContain('WhatsApp');
        });

        // PRESENT-ONLY: no [NOT_PROVIDED] counterpart. An absence line would cost
        // a token on every reply for every merchant (almost none set this) and
        // invite the model to volunteer "we have no WhatsApp". Keeping it absent
        // makes v61 byte-identical to v60 for anyone who hasn't filled it in.
        it('emits no WhatsApp line at all when unset', () => {
            const block = formatBusinessInfoPrompt({ address: 'Damascus' });
            expect(block).not.toContain('WhatsApp');
            expect(block).not.toContain('واتساب');
        });

        it('renders hours in Saturday-first week order (CLDR ar-SY), not insertion order', () => {
            const block = formatBusinessInfoPrompt({
                hours: {
                    fri: ['closed'],
                    mon: ['09:00-17:00'],
                    sun: ['10:00-14:00'],
                },
            });
            expect(block).not.toBeNull();
            const sundayIdx = block!.indexOf('Sunday');
            const mondayIdx = block!.indexOf('Monday');
            const fridayIdx = block!.indexOf('Friday');
            expect(sundayIdx).toBeGreaterThan(-1);
            expect(sundayIdx).toBeLessThan(mondayIdx);
            expect(mondayIdx).toBeLessThan(fridayIdx);
        });

        // The «من الأحد للسبت» regression (Damascus institute, 2026-08-01): a
        // Sunday-first/Monday-first week in the prompt nudges the model toward
        // the US week convention. Our markets start the week on Saturday and
        // end it on the Friday weekend (CLDR ar-SY/ar-EG/ar-LY).
        it('renders a full week starting Saturday and ending Friday', () => {
            const block = formatBusinessInfoPrompt({
                hours: {
                    mon: ['09:00-20:00'], tue: ['09:00-20:00'], wed: ['09:00-20:00'],
                    thu: ['09:00-20:00'], fri: ['closed'], sat: ['09:00-20:00'], sun: ['09:00-20:00'],
                },
            });
            expect(block).not.toBeNull();
            const idx = (d: string) => block!.indexOf(d);
            expect(idx('Saturday')).toBeLessThan(idx('Sunday'));
            expect(idx('Sunday')).toBeLessThan(idx('Monday'));
            expect(idx('Wednesday')).toBeLessThan(idx('Thursday'));
            expect(idx('Thursday')).toBeLessThan(idx('Friday'));
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

        // WhatsApp is PRESENT-ONLY (no [NOT_PROVIDED] line) and channels never
        // reach the narrative fallback (D-010) — so an unconfirmed value must
        // count as absent EVERYWHERE, including the empty-profile gate. Without
        // that, a store-synced suggestion the merchant never confirmed would be
        // the sole trigger of a block made entirely of [NOT_PROVIDED] lines:
        // tokens on every reply, conjured out of a value no prompt can show.
        it('returns null when an unconfirmed WhatsApp is the ONLY value', () => {
            const block = formatBusinessInfoPrompt(
                { channels: { whatsapp: '+218911234567' } },
                fbSync('channels'),
            );
            expect(block).toBeNull();
        });

        it('omits an unconfirmed WhatsApp from an otherwise-authoritative block', () => {
            const block = formatBusinessInfoPrompt(
                { address: 'Damascus', channels: { whatsapp: '+218911234567' } },
                { ...editor('address'), ...fbSync('channels') },
            );
            expect(block).toContain('Damascus');
            expect(block).not.toContain('+218911234567');
            // PRESENT-ONLY holds for the unconfirmed case too: omitted, not guarded.
            expect(block).not.toContain('WhatsApp');
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
            expect(block).not.toContain('- Phones / الهاتف / الأرقام: [NOT_PROVIDED]');
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
            expect(block).toContain('- Phones / الهاتف / الأرقام: [NOT_PROVIDED]');
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

/**
 * `businessPhoneList` is THE reader of the `phones[]` / legacy `phone` dual
 * shape. It is shared rather than inlined because the two consumers must agree:
 * the prompt PUBLISHES these numbers to customers, and lead capture EXCLUDES
 * them so a customer echoing one back never becomes a lead whose call button
 * dials the merchant. A local `p.phones ?? [p.phone]` reads an EMPTY array as
 * "no phones" ([] is not nullish) while the prompt still publishes the legacy
 * `phone` — the two halves disagreeing is exactly the bug class here.
 */
describe('businessPhoneList', () => {
    it('returns the phones array when it has entries', () => {
        expect(businessPhoneList({ phones: ['0911000210', '0911000220'] })).toEqual(['0911000210', '0911000220']);
    });

    it('falls back to the legacy single `phone` when `phones` is ABSENT', () => {
        expect(businessPhoneList({ phone: '0933301022' })).toEqual(['0933301022']);
    });

    it('falls back to the legacy single `phone` when `phones` is an EMPTY array', () => {
        // The divergence guard: `phones ?? [phone]` would return [] here and the
        // merchant's published line would silently leave the exclusion set.
        expect(businessPhoneList({ phones: [], phone: '0933301022' })).toEqual(['0933301022']);
    });

    it('prefers `phones` over the legacy `phone` when both are set', () => {
        expect(businessPhoneList({ phones: ['0911000210'], phone: '0933301022' })).toEqual(['0911000210']);
    });

    it('drops blank and whitespace-only entries', () => {
        expect(businessPhoneList({ phones: ['0911000210', '', '   '] })).toEqual(['0911000210']);
        expect(businessPhoneList({ phones: [], phone: '   ' })).toEqual([]);
    });

    it('returns [] when the profile carries no phone at all', () => {
        expect(businessPhoneList({})).toEqual([]);
    });
});

/**
 * The tri-shape reader. `businessPhoneList` above keeps returning bare numbers
 * for every caller that wants something dialable; this returns the same lines
 * WITH whatever purpose the merchant gave them.
 */
describe('businessPhoneEntries', () => {
    it('reads bare strings, entry objects, and a mix of both', () => {
        expect(businessPhoneEntries({ phones: ['0911000210'] }))
            .toEqual([{ number: '0911000210' }]);
        expect(businessPhoneEntries({ phones: [{ number: '0911000299', description: 'الإدارة' }] }))
            .toEqual([{ number: '0911000299', description: 'الإدارة' }]);
        expect(businessPhoneEntries({ phones: ['0911000210', { number: '0911000299', description: 'الإدارة' }] }))
            .toEqual([{ number: '0911000210' }, { number: '0911000299', description: 'الإدارة' }]);
    });

    it('keeps the legacy `phone` fallback rules verbatim', () => {
        expect(businessPhoneEntries({ phone: '0933301022' })).toEqual([{ number: '0933301022' }]);
        expect(businessPhoneEntries({ phones: [], phone: '0933301022' })).toEqual([{ number: '0933301022' }]);
        expect(businessPhoneEntries({})).toEqual([]);
    });

    it('drops blanks in either shape and omits an empty description', () => {
        expect(businessPhoneEntries({ phones: ['', '   ', { number: '  ' }, { number: '0911000210', description: '  ' }] }))
            .toEqual([{ number: '0911000210' }]);
    });

    it('businessPhoneList stays numbers-only over described entries', () => {
        // Every caller that dials, excludes, or string-compares a number reads
        // through this. If it ever returned objects, `texts.join()` in lead
        // capture would render "[object Object]" and the merchant's own numbers
        // would silently leave the exclusion set.
        expect(businessPhoneList({ phones: [{ number: '0911000299', description: 'الإدارة' }, '0911000210'] }))
            .toEqual(['0911000299', '0911000210']);
    });
});

/**
 * ⭐ THE REPLY-QUALITY GUARANTEE.
 *
 * Adding descriptions and an email field touches the prompt of EVERY merchant.
 * The safety argument is not "we sampled replies and saw no change" — it is
 * that for a merchant who has set neither, the block is character-for-character
 * what it was before, so the model's input is provably identical and its
 * replies cannot drift. Substring assertions cannot prove that; these can.
 *
 * If one of these fails, do not adjust the expected string — the render changed
 * for the existing fleet, which retires every semantic reply-cache key and puts
 * live reply behavior at risk.
 *
 * The expected blocks below were transcribed from the formatter as it stood on
 * origin/main (154ae1ae) — verified equal by running both side by side — so
 * they pin the PREVIOUS bytes, not this branch's own output.
 */
describe('byte-identical render — profiles without descriptions or email', () => {
    const HEADER = [
        'BUSINESS_INFO (structured, merchant-confirmed — the CURRENT values):',
        'If <business_knowledge> states a DIFFERENT value for any field listed here, the value in BUSINESS_INFO is the correct one — the narrative text is outdated. Answer from BUSINESS_INFO and never repeat the outdated value.',
        'When a field is [NOT_PROVIDED], you MUST NOT invent a value. Politely decline in the merchant\'s brand voice and offer an alternative channel if available (e.g. "we don\'t have a public phone — please visit us at <address>" or "I\'m here in chat — what can I help with?").',
        '',
    ].join('\n');

    it('phones only', () => {
        expect(formatBusinessInfoPrompt({ phones: ['0911000210', '0911000220'] })).toBe(
            `${HEADER}\n`
            + '- Address / العنوان / الموقع: [NOT_PROVIDED]\n'
            + '- Phones / الهاتف / الأرقام: 0911000210, 0911000220\n'
            + '- Hours / أوقات الدوام: [NOT_PROVIDED]\n'
            + '- Policies / السياسات: [NOT_PROVIDED]',
        );
    });

    it('legacy singular phone only', () => {
        expect(formatBusinessInfoPrompt({ phone: '0933301022' })).toBe(
            `${HEADER}\n`
            + '- Address / العنوان / الموقع: [NOT_PROVIDED]\n'
            + '- Phones / الهاتف / الأرقام: 0933301022\n'
            + '- Hours / أوقات الدوام: [NOT_PROVIDED]\n'
            + '- Policies / السياسات: [NOT_PROVIDED]',
        );
    });

    it('address only — the phones line is the absence marker', () => {
        expect(formatBusinessInfoPrompt({ address: 'دمشق، المزة' })).toBe(
            `${HEADER}\n`
            + '- Address / العنوان / الموقع: دمشق، المزة\n'
            + '- Phones / الهاتف / الأرقام: [NOT_PROVIDED]\n'
            + '- Hours / أوقات الدوام: [NOT_PROVIDED]\n'
            + '- Policies / السياسات: [NOT_PROVIDED]',
        );
    });

    it('address + phones + hours + whatsapp + policies — the full shape', () => {
        expect(formatBusinessInfoPrompt({
            address: 'دمشق، المزة',
            city: 'دمشق',
            phones: ['0911000210'],
            hours: { saturday: ['09:00-18:00'], friday: ['closed'] },
            channels: { whatsapp: '+963911000210' },
            policies: { shipping: 'التوصيل خلال ٤٨ ساعة' },
        })).toBe(
            `${HEADER}\n`
            + '- Address / العنوان / الموقع: دمشق، المزة, دمشق\n'
            + '- Phones / الهاتف / الأرقام: 0911000210\n'
            + '- Hours / أوقات الدوام (24h, "closed" if shut, "all day" if 24/7):\n'
            + '  Saturday: 09:00-18:00\n'
            + '  Friday: closed\n'
            + '- WhatsApp / واتساب: +963911000210\n'
            + '- Policies / السياسات:\n'
            + '  Shipping: التوصيل خلال ٤٨ ساعة',
        );
    });

    it('fb_sync phones are omitted, not rendered — provenance gate intact', () => {
        const prov: MerchantProvenanceMap = { phones: { source: 'fb_sync', confirmedAt: null } };
        expect(formatBusinessInfoPrompt({ address: 'دمشق', phones: ['0911000210'] }, prov)).toBe(
            `${HEADER}\n`
            + '- Address / العنوان / الموقع: دمشق\n'
            + '- Hours / أوقات الدوام: [NOT_PROVIDED]\n'
            + '- Policies / السياسات: [NOT_PROVIDED]',
        );
    });

    it('an empty profile still yields no block at all', () => {
        expect(formatBusinessInfoPrompt({})).toBeNull();
        expect(formatBusinessInfoPrompt({ phones: [] })).toBeNull();
    });
});

/**
 * The same guarantee stated structurally: for any profile, rendering it with
 * bare-string phones must equal rendering it with the equivalent description-
 * less entry objects. This is what makes the canonical-form invariant safe —
 * even if a non-canonical value somehow reached storage, the published prompt
 * would not change.
 */
describe('shape equivalence — strings vs description-less objects', () => {
    const profiles: BusinessProfile[] = [
        { phones: ['0911000210'] },
        { phones: ['0911000210', '0911000220'], address: 'دمشق' },
        { phones: ['0911000210'], hours: { saturday: ['09:00-18:00'] }, channels: { whatsapp: ['0911000210'] } },
        { phones: ['0911000210'], policies: { shipping: 'التوصيل خلال ٤٨ ساعة', returns: 'الإرجاع خلال ٧ أيام' } },
    ];

    it.each(profiles.map((p, i) => [i, p] as const))('profile %i renders identically', (_i, profile) => {
        const asObjects: BusinessProfile = {
            ...profile,
            phones: (profile.phones ?? []).map((p) => ({ number: p as string })),
        };
        expect(formatBusinessInfoPrompt(asObjects)).toBe(formatBusinessInfoPrompt(profile));
    });
});

describe('per-phone description', () => {
    it('renders the purpose as a parenthesized aside beside its number', () => {
        const block = formatBusinessInfoPrompt({
            phones: [
                { number: '0911000299', description: 'الإدارة — عند الطلب فقط' },
                '0911000210',
            ],
        });
        expect(block).toContain('- Phones / الهاتف / الأرقام: 0911000299 (الإدارة — عند الطلب فقط), 0911000210');
    });

    it('stays well inside the prompt budget at the 10-entry maximum', () => {
        // Descriptions must not be able to crowd out the policies that follow.
        const phones = Array.from({ length: 10 }, (_, i) => ({
            number: `+96391100${String(i).padStart(4, '0')}`,
            description: 'ب'.repeat(MAX_PHONE_DESCRIPTION_LENGTH),
        }));
        const line = (formatBusinessInfoPrompt({ phones }) ?? '')
            .split('\n').find((l) => l.startsWith('- Phones'))!;
        expect(line.length).toBeLessThan(700);
    });
});

describe('email', () => {
    it('renders present-only, after WhatsApp and before Policies', () => {
        const block = formatBusinessInfoPrompt({
            phones: ['0911000210'],
            channels: { whatsapp: '+963911000210' },
            email: 'reservations@shifa-dental.com',
            policies: { shipping: 'التوصيل خلال ٤٨ ساعة' },
        }) ?? '';
        const lines = block.split('\n');
        const wa = lines.findIndex((l) => l.startsWith('- WhatsApp'));
        const email = lines.findIndex((l) => l.startsWith('- Email'));
        const policies = lines.findIndex((l) => l.startsWith('- Policies'));
        expect(lines[email]).toBe('- Email / البريد الإلكتروني: reservations@shifa-dental.com');
        expect(wa).toBeLessThan(email);
        expect(email).toBeLessThan(policies);
    });

    it('emits NO absence line when unset — every existing merchant is untouched', () => {
        const block = formatBusinessInfoPrompt({ phones: ['0911000210'] }) ?? '';
        expect(block).not.toContain('Email');
        expect(block).not.toContain('البريد الإلكتروني');
    });

    it('counts as grounding on its own — an email-only profile yields a block', () => {
        // businessReadiness treats a non-null block as a grounding source. An
        // email IS a real, answerable fact, so this is the intended behavior.
        expect(formatBusinessInfoPrompt({ email: 'a@b.com' })).not.toBeNull();
    });

    it('an unconfirmed fb_sync email is absent everywhere — no block conjured', () => {
        const prov: MerchantProvenanceMap = { email: { source: 'fb_sync', confirmedAt: null } };
        expect(formatBusinessInfoPrompt({ email: 'a@b.com' }, prov)).toBeNull();
    });

    it('a blank email is treated as unset', () => {
        expect(formatBusinessInfoPrompt({ email: '   ' })).toBeNull();
    });
});
