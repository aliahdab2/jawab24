/**
 * Format a BusinessProfile into a structured BUSINESS_INFO block that the
 * AI treats as authoritative — beating stale narrative chunks retrieved
 * from raw KB text (Eval Case #19: "structured > narrative" precedence).
 *
 * Stage 2.6. Pure function; safe to call from frontend (preview) or
 * backend (prompt assembly).
 *
 * Returns null if the profile is empty enough that injecting the block
 * would add no signal — saves prompt tokens at scale.
 *
 * The "[NOT_PROVIDED]" markers are deliberate: the prompt block instructs
 * the AI to refuse rather than invent values for those fields. Without
 * the marker, the AI's default behavior is to confabulate plausible-
 * looking data (e.g. the Damascus institute "1234567" phone hallucination
 * that originally motivated this stage).
 *
 * PROVENANCE GATING (the "KB wins, Facebook is fallback" contract):
 * The block is authoritative — the model is told to prefer it over the
 * merchant's own <business_knowledge> (KB) text. So ONLY merchant-authored
 * facts may appear here. A value whose provenance is 'fb_sync' is an
 * UNCONFIRMED Facebook auto-sync (Option B promotes FB suggestions into
 * `merchant` with confirmedAt: null); presenting it as authoritative makes
 * it override the hours/phone the merchant typed into their KB — the
 * reported production bug. Such fields are therefore OMITTED here and reach
 * the model only through the lower-authority narrative profile
 * (`formatBusinessProfile`), i.e. Facebook is a fallback, never an override.
 *
 * A field counts as authoritative when its provenance source is 'editor' or
 * 'kb_extract', OR when no provenance map is supplied / no entry exists for
 * it (legacy rows predating Option B could only have been editor writes —
 * matches normalizeLegacyProvenance's conservative default). Genuinely
 * ABSENT fields still get [NOT_PROVIDED] so the anti-hallucination guard
 * (#11) survives even for FB-only merchants.
 */

import type { BusinessProfile } from './index';
import type { BusinessPhoneEntry } from './businessPhone';
import { sanitizePhoneDescription } from './businessPhone';
import type { MerchantProvenanceMap } from './businessProfileMerge';
import { SHORT_DAY_KEYS, LONG_DAY_KEYS, DAY_LABELS_EN } from './businessHours';

// Saturday-first (CLDR ar-SY/ar-EG week order) — see businessHours.ts.
const DAY_ORDER = LONG_DAY_KEYS;
const DAY_SHORT_ORDER = SHORT_DAY_KEYS;
const DAY_LABELS = DAY_LABELS_EN;

const NOT_PROVIDED = '[NOT_PROVIDED]';

/** The three component fields that compose the single "Address" line. */
const ADDRESS_FIELDS: ReadonlyArray<keyof BusinessProfile> = ['address', 'city', 'country'];

/**
 * True unless the field is unconfirmed (so it must not override the merchant's
 * own KB text). No provenance map / no entry → authoritative (legacy default).
 *
 * A field is authoritative when:
 *   - no provenance entry           → legacy / preview caller, can't gate (default keep)
 *   - source 'kb_extract'           → derived FROM the KB, so it cannot contradict it
 *   - source 'editor' AND confirmedAt set → a genuine merchant edit
 *
 * It is DEMOTED (flows only via the lower-authority narrative fallback) when:
 *   - source 'fb_sync'              → unconfirmed Facebook auto-sync
 *   - source 'editor' AND confirmedAt == null → NOT a real edit. A real editor
 *     save stamps confirmedAt on every field it touches (applyMerchantEdit:
 *     changed or explicitly-confirmed fields only, since the 2026-08-08
 *     laundering fix), so this state is only ever produced by normalizeLegacyProvenance, which
 *     optimistically assumed pre-split merchant data was editor-typed. On pages
 *     whose flat `business_profile` was Facebook-synced before the merchant/
 *     suggestions split, that data is actually FB-derived (prod page 39aeab89:
 *     `merchant` === `suggestions`, Friday "00:00-23:45" = FB "open all day"),
 *     so it must not be allowed to override the KB hours/phone the merchant typed.
 */
export function isFieldAuthoritative(
    provenance: MerchantProvenanceMap | undefined,
    field: keyof BusinessProfile,
): boolean {
    const entry = provenance?.[field];
    if (!entry) return true;                       // legacy / no provenance → keep (back-compat)
    if (entry.source === 'fb_sync') return false;  // unconfirmed FB sync → fallback only
    if (entry.source === 'editor') return entry.confirmedAt != null; // real edit sets confirmedAt
    return true;                                   // kb_extract → KB-derived, agrees with the KB
}

/**
 * Build the address line from only the merchant-authored component fields.
 * Returns both the authoritative join (what may appear in the block) and
 * whether any component has a value at all (to tell ABSENT from FB-only).
 */
function joinAddress(
    p: BusinessProfile,
    provenance?: MerchantProvenanceMap,
): { authoritative: string | null; hasAnyValue: boolean } {
    const isNonEmptyStr = (s: unknown): s is string => typeof s === 'string' && s.trim() !== '';
    const all = ADDRESS_FIELDS
        .map(f => p[f])
        .filter(isNonEmptyStr);
    const authoritative = ADDRESS_FIELDS
        .filter(f => isFieldAuthoritative(provenance, f))
        .map(f => p[f])
        .filter(isNonEmptyStr);
    return {
        authoritative: authoritative.length > 0 ? authoritative.join(', ') : null,
        hasAnyValue: all.length > 0,
    };
}

/** The merchant's call lines, each with whatever purpose they gave it. THE one
 *  reader of the `phones` tri-shape (entry objects / bare strings / the legacy
 *  single `phone`) — every consumer goes through this or `businessPhoneList`,
 *  so the shapes can never drift apart.
 *
 *  The fallback rule is the subtle part: an EMPTY `phones` array still falls
 *  back to the legacy `phone`. A caller that writes `p.phones ?? [p.phone]`
 *  gets this wrong (`[]` is not nullish), and the two halves disagreeing is a
 *  real bug class here — the prompt PUBLISHES the legacy number to customers
 *  while lead capture, reading it the other way, would not know to exclude it,
 *  so the merchant's own line becomes a lead whose call button dials them
 *  (`getBusinessPhones`, the June 2026 incident class). */
export function businessPhoneEntries(p: BusinessProfile): BusinessPhoneEntry[] {
    // ⚠️ TOTAL over the column, not just over the type. `business_profile` is
    // schemaless jsonb with four writers (editor, fb_sync, kb_extract, pre-split
    // legacy), so `phones` can hold something that is not an array. The old
    // `p.phones && p.phones.length > 0` admitted a bare STRING — length passes,
    // `.map` then throws — and since D-087 this reader also runs inside
    // `serializeListPage`, where one bad row would 500 `GET /pages` for the whole
    // workspace: dashboard, settings, inbox pickers, everything. Behaviour is
    // unchanged for every well-formed profile; only malformed input, which used
    // to throw, now falls through to the legacy single `phone`.
    const list = Array.isArray(p.phones) ? p.phones : [];
    const entries = list.length > 0
        ? list
        : (typeof p.phone === 'string' && p.phone.trim() !== '' ? [p.phone] : []);

    return entries
        .map((e) => {
            // ⚠️ A bare string is passed through VERBATIM, blanks aside. It is
            // tempting to `.trim()` here, and it would even be tidier — but a
            // merchant storing « 0911000210 » would then get a different
            // BUSINESS_INFO line than they get today, which retires their
            // semantic reply-cache keys and re-opens reply behaviour that is
            // currently settled. Byte-identity for existing data beats tidiness;
            // trimming belongs at the WRITE boundary (`normalizePhoneEntries`),
            // where it changes what is stored rather than what is published.
            if (typeof e === 'string') return { number: e };
            if (!e || typeof e.number !== 'string') return { number: '' };
            // Entry objects are new in this format, so there is no prior render
            // to preserve — they are normalized on write and read back clean.
            const description = e.description?.trim();
            return description ? { number: e.number.trim(), description } : { number: e.number.trim() };
        })
        .filter((e) => e.number.trim() !== '');
}

/** The merchant's call lines as bare numbers. Semantics are unchanged from
 *  before descriptions existed, so every caller that wants something dialable
 *  (lead-capture exclusion, the post contact suffix, WhatsApp marks) keeps
 *  working without knowing descriptions exist. */
export function businessPhoneList(p: BusinessProfile): string[] {
    return businessPhoneEntries(p).map((e) => e.number);
}

/**
 * "Can the assistant hand this customer a way to reach the business?" — true
 * when BUSINESS_INFO will publish a phone or a WhatsApp number for this page.
 *
 * ⭐ This is the INFO-DESK precondition. That block (ai-worker promptBuilder,
 * D-085) forbids asking the customer for their details and instead says «point
 * them to ONE contact channel from BUSINESS_INFO … If no channel is on file, be
 * honest you don't have one and stop». On a page with no publishable channel
 * those two rules leave the assistant with nothing to say to a customer who
 * wants to buy — it neither asks nor routes. Measured on prod 2026-08-20: of 36
 * live pages only 7 pass this predicate; 10 of the 17 that store phones fail it
 * because the number came from `fb_sync` and was never confirmed.
 *
 * ⚠️ Gated by the SAME `isFieldAuthoritative` calls `formatBusinessInfoPrompt`
 * applies to each field (phones at its Phones line, WhatsApp where
 * `whatsappValue` is derived). Deliberately not a re-derivation: a warning that
 * disagreed with the prompt would send merchants to fix a page that is already
 * fine, or clear a page that is not. Change the gate there, change it here.
 *
 * Deliberately narrower than `findGroundingSource` (services/businessReadiness):
 * that answers "can this page answer anything at all", which an address or a KB
 * satisfies. A customer cannot phone an address.
 */
export function hasRoutableContactChannel(
    p: BusinessProfile | null | undefined,
    provenance?: MerchantProvenanceMap,
): boolean {
    if (!p || typeof p !== 'object') return false;
    const hasPhone = isFieldAuthoritative(provenance, 'phones') && businessPhoneEntries(p).length > 0;
    const hasWhatsapp = isFieldAuthoritative(provenance, 'channels') && whatsappNumbers(p).length > 0;
    // Email counts, and the block says why: `formatBusinessInfoPrompt` publishes
    // it under the same authority gate, right beside WhatsApp, as one of "the two
    // contact channels". A page whose only channel is an email would otherwise be
    // told it has none — while INFO-DESK happily routes the customer to it.
    // `typeof`, not `?.trim()`: the column is schemaless, so `email` can hold a
    // number — and this predicate runs inside `serializeListPage`, where a throw
    // is a 500 on every merchant screen rather than one missing warning.
    const hasEmail = isFieldAuthoritative(provenance, 'email')
        && typeof p.email === 'string' && p.email.trim() !== '';
    return hasPhone || hasWhatsapp || hasEmail;
}

/**
 * One entry as the prompt states it. A description is an aside in parentheses:
 *  the descriptions merchants write contain dashes of their own
 *  («الإدارة — عند الطلب فقط»), and `', '` already separates entries.
 *
 * ⭐ Sanitized HERE as well as on write, and the duplication is the point. This
 * string is interpolated into the AUTHORITATIVE BUSINESS_INFO block, so a
 * newline in a description could forge an extra `- Label: value` line and a bidi
 * control could reorder one — i.e. this is a rendering boundary, and a rendering
 * boundary defends itself (OWASP: sanitize where the value is USED, not only
 * where it arrived).
 *
 * Sanitizing only on write was safe ONLY as long as every producer went through
 * `normalizePhoneEntries`, and that is not an invariant this function can check:
 * `fb_sync` and the KB fact extractor write through the BASE schema, a stored
 * row predates any given version of the write path, and a direct SQL edit
 * bypasses all of it. "Unreached" is not "impossible".
 *
 * Free of byte-identity risk because `sanitizePhoneDescription` is idempotent —
 * on a value that already came through the write boundary it returns the same
 * string, so no existing rendered line can move. (And it renders the number
 * verbatim, unchanged: see the note in `businessPhoneEntries`.)
 */
function renderPhoneEntry(e: BusinessPhoneEntry): string {
    if (!e.description) return e.number;
    const description = sanitizePhoneDescription(e.description);
    return description ? `${e.number} (${description})` : e.number;
}

function joinPhones(p: BusinessProfile): string | null {
    const entries = businessPhoneEntries(p);
    return entries.length > 0 ? entries.map(renderPhoneEntry).join(', ') : null;
}

/** Normalize `channels.whatsapp` (legacy single string OR array) to a clean
 *  list. THE one reader of the field's dual shape — every consumer (prompt,
 *  coverage, editor) goes through this so the legacy string never leaks. */
export function whatsappNumbers(p: BusinessProfile): string[] {
    const wa = p.channels?.whatsapp;
    const list = Array.isArray(wa) ? wa : typeof wa === 'string' ? [wa] : [];
    return list.map((n) => n.trim()).filter(Boolean);
}

/** The merchant's WhatsApp contact(s), if they gave any. Distinct from
 *  `phones`: numbers customers can MESSAGE, not necessarily ones they can
 *  call. */
function formatWhatsapp(p: BusinessProfile): string | null {
    const numbers = whatsappNumbers(p);
    return numbers.length > 0 ? numbers.join(', ') : null;
}

function formatHours(p: BusinessProfile): string | null {
    if (!p.hours || Object.keys(p.hours).length === 0) return null;

    // Pick whichever key set the merchant uses (long "monday" or short "mon").
    const useShort = Object.keys(p.hours).some((k) => DAY_SHORT_ORDER.includes(k as typeof DAY_SHORT_ORDER[number]));
    const order = useShort ? DAY_SHORT_ORDER : DAY_ORDER;

    const lines: string[] = [];
    for (const day of order) {
        const entries = p.hours[day];
        if (!entries || entries.length === 0) continue;
        // canonical entries are already "HH:MM-HH:MM" / "closed" / "all day"
        // — join multi-window entries with " / " on a single line.
        lines.push(`  ${DAY_LABELS[day] ?? day}: ${entries.join(' / ')}`);
    }
    return lines.length > 0 ? lines.join('\n') : null;
}

function formatPolicies(p: BusinessProfile): string | null {
    const pol = p.policies;
    if (!pol) return null;
    const lines: string[] = [];
    if (pol.shipping?.trim()) lines.push(`  Shipping: ${pol.shipping.trim()}`);
    if (pol.returns?.trim()) lines.push(`  Returns: ${pol.returns.trim()}`);
    if (pol.payment?.trim()) lines.push(`  Payment: ${pol.payment.trim()}`);
    if (pol.booking?.trim()) lines.push(`  Booking: ${pol.booking.trim()}`);
    return lines.length > 0 ? lines.join('\n') : null;
}

/**
 * Build the prompt block. Returns null when the profile carries no
 * merchant-authored signal — caller skips the block entirely so the KB /
 * narrative profile governs (and to save tokens).
 *
 * @param profile    the `merchant` half of the business_profile container.
 * @param provenance per-field provenance for `profile`. When supplied,
 *                   fields whose source is 'fb_sync' (unconfirmed Facebook
 *                   auto-sync) are OMITTED so they cannot override the
 *                   merchant's own KB text — see the file header. Omit the
 *                   argument to treat every field as authoritative (legacy
 *                   / preview callers without a provenance map).
 *
 * Per-field render (in priority order):
 *   - authoritative value present  → emit the value line.
 *   - genuinely absent everywhere  → emit `[NOT_PROVIDED]` (anti-hallucination).
 *   - present but FB-only (fb_sync)→ OMIT the line (flows via fallback).
 */
/**
 * How many of the profile's ANSWERABLE facts carry a value — the fields that
 * become BUSINESS_INFO lines: address, phones, hours, policies, WhatsApp, email.
 *
 * Deliberately EXCLUDES `name`, `category`, `about`, `website` and
 * `language_hint`. Those are page metadata: `language_hint` is system-derived,
 * and the rest arrive from Facebook sync. None of them answers a customer
 * question, and none contributes a BUSINESS_INFO line — which is exactly why
 * `formatBusinessInfoPrompt` has never counted them when deciding whether to
 * emit a block at all.
 *
 * Exported because the support console needs the same answer ("has this
 * merchant filled in any structured facts?") and a raw `Object.keys` count is a
 * WRONG second definition of it: measured on prod 2026-08-20, the modal live
 * page carries exactly four merchant keys — `name`, `category`, `language_hint`
 * and `website`/`about` — so a key count reports "4 fields of Business Info"
 * for a page that contributes nothing to any prompt. 24 of 92 live pages sit on
 * that value. WhatsApp and email are provenance-gated here for the same reason
 * they are gated below: an unconfirmed suggestion contributes to no prompt and
 * must count as absent everywhere.
 */
export function countBusinessInfoFacts(
    profile: BusinessProfile | null | undefined,
    provenance?: MerchantProvenanceMap,
): number {
    if (!profile) return 0;
    const whatsappRaw = formatWhatsapp(profile);
    const emailRaw = profile.email?.trim() || null;
    return [
        joinAddress(profile, provenance).hasAnyValue,
        !!joinPhones(profile),
        !!formatHours(profile),
        !!formatPolicies(profile),
        !!(whatsappRaw && isFieldAuthoritative(provenance, 'channels')),
        !!(emailRaw && isFieldAuthoritative(provenance, 'email')),
    ].filter(Boolean).length;
}

export function formatBusinessInfoPrompt(
    profile: BusinessProfile | null | undefined,
    provenance?: MerchantProvenanceMap,
): string | null {
    if (!profile) return null;

    const address = joinAddress(profile, provenance);
    const phonesValue = joinPhones(profile);
    const hoursValue = formatHours(profile);
    const policiesValue = formatPolicies(profile);
    // WhatsApp is gated ONCE, up here, because unlike every other field it has
    // no [NOT_PROVIDED] counterpart below AND no narrative fallback (D-010
    // keeps channels out of formatBusinessProfile). So a non-authoritative
    // value — e.g. a store-synced suggestion the merchant never confirmed —
    // contributes nothing to ANY prompt and must count as absent everywhere.
    // Were it counted in `anyValueAtAll`, a profile whose only value is an
    // unconfirmed WhatsApp would conjure a block of pure [NOT_PROVIDED] lines
    // out of nothing: tokens on every reply, asserting "we don't know our own
    // address/phone/hours" for a merchant who simply hasn't confirmed a
    // suggestion yet.
    const whatsappRaw = formatWhatsapp(profile);
    const whatsappValue = whatsappRaw && isFieldAuthoritative(provenance, 'channels') ? whatsappRaw : null;
    // Email is gated here for exactly the reasons spelled out for WhatsApp: it
    // is present-only below, so a non-authoritative value must count as absent
    // everywhere rather than conjure a block of [NOT_PROVIDED] lines.
    const emailRaw = profile.email?.trim() || null;
    const emailValue = emailRaw && isFieldAuthoritative(provenance, 'email') ? emailRaw : null;

    // A truly-empty profile (no field has a value anywhere) → no block, as
    // before: nothing to assert and nothing to guard, and skipping saves
    // tokens at scale. Preserves the long-standing empty-profile → null
    // contract. NOTE: this is distinct from the all-FB-only case below — here
    // there is no value at all, so there's genuinely nothing to hallucinate
    // against.
    // Same six fields, one definition — see countBusinessInfoFacts. Kept as a
    // count rather than a boolean so the support console cannot answer "does
    // this profile hold facts?" with a different expression than the prompt.
    if (countBusinessInfoFacts(profile, provenance) === 0) return null;

    // The body lines (everything below the header + directive). A field
    // contributes a line only when it is authoritative-present or genuinely
    // absent; an FB-only field contributes nothing here and reaches the model
    // through the lower-authority narrative profile instead.
    const fieldLines: string[] = [];

    // Address (composite of address/city/country, each gated independently).
    if (address.authoritative) {
        fieldLines.push(`- Address / العنوان / الموقع: ${address.authoritative}`);
    } else if (!address.hasAnyValue) {
        fieldLines.push(`- Address / العنوان / الموقع: ${NOT_PROVIDED}`);
    } // else: FB-only → omit.

    // Phones. Legacy singular `phone` is not provenance-tracked → authoritative.
    const phonesAuthoritative = isFieldAuthoritative(provenance, 'phones');
    if (phonesValue && phonesAuthoritative) {
        fieldLines.push(`- Phones / الهاتف / الأرقام: ${phonesValue}`);
    } else if (!phonesValue) {
        fieldLines.push(`- Phones / الهاتف / الأرقام: ${NOT_PROVIDED}`);
    } // else: FB-only → omit.

    // Hours.
    if (hoursValue && isFieldAuthoritative(provenance, 'hours')) {
        fieldLines.push('- Hours / أوقات الدوام (24h, "closed" if shut, "all day" if 24/7):');
        fieldLines.push(hoursValue);
    } else if (!hoursValue) {
        fieldLines.push(`- Hours / أوقات الدوام: ${NOT_PROVIDED}`);
    } // else: FB-only → omit.

    // WhatsApp — PRESENT-ONLY, deliberately no [NOT_PROVIDED] counterpart.
    // The fields above are things customers ask about constantly, so telling the
    // model they are genuinely absent stops it inventing them. WhatsApp is an
    // optional extra channel almost no merchant sets: emitting an absence line
    // would add a token to every reply for every merchant and invite the model
    // to volunteer "we have no WhatsApp", which nobody asked. Omitting it keeps
    // this change a no-op for anyone who hasn't filled it in.
    // (Authority already applied where `whatsappValue` is derived, above.)
    if (whatsappValue) {
        fieldLines.push(`- WhatsApp / واتساب: ${whatsappValue}`);
    }

    // Email — PRESENT-ONLY, same reasoning as WhatsApp directly above: an
    // absence line would cost a token on every reply for every merchant and
    // invite the model to volunteer "we have no email". Kept adjacent to
    // WhatsApp so the two contact channels — and the one rule they share —
    // read as a single block.
    if (emailValue) {
        fieldLines.push(`- Email / البريد الإلكتروني: ${emailValue}`);
    }

    // Policies.
    if (policiesValue && isFieldAuthoritative(provenance, 'policies')) {
        fieldLines.push('- Policies / السياسات:');
        fieldLines.push(policiesValue);
    } else if (!policiesValue) {
        fieldLines.push(`- Policies / السياسات: ${NOT_PROVIDED}`);
    } // else: FB-only → omit.

    // Every field that has a value is FB-only (so all were omitted) and no
    // field is genuinely absent → no line was produced. Inject nothing: the
    // narrative profile (Facebook fallback) + the merchant's KB text govern.
    // This is the load-bearing half of "KB wins, Facebook is fallback".
    // (When some field IS genuinely absent, fieldLines carries its
    // [NOT_PROVIDED] guard, so the #11 anti-hallucination protection survives
    // even for merchants whose only data is FB-synced.)
    if (fieldLines.length === 0) return null;

    // The defensive refusal instruction is placed FIRST, immediately under the
    // header, NOT last. The consumer (ai-worker/openai.ts) hard-caps the injected
    // block at BUSINESS_INFO_MAX_CHARS; a fully-populated profile (4 policies ×
    // 500 chars + address + phones + hours) can exceed that cap, and if the
    // directive lived at the bottom it would be the first thing truncated away —
    // dropping the anti-hallucination guard exactly for the merchants with the
    // richest data. Putting it up top guarantees it survives truncation.
    // The persona/brand voice lives earlier in the prompt (BRAND VOICE NOTES in
    // openai.ts) so the model picks a tone-matched refusal automatically.
    const sections: string[] = [
        'BUSINESS_INFO (structured, merchant-confirmed — the CURRENT values):',
        // "prefer over <business_knowledge>" was too weak to survive an actual
        // disagreement: eval #720 (v57) put a merchant-confirmed address here and
        // a stale one in the KB narrative, and the model answered from the KB.
        // The explicit conflict framing below is the wording that DID hold for
        // <product_catalog> (cases #717/#718) — same medicine, same phase.
        'If <business_knowledge> states a DIFFERENT value for any field listed here, ' +
        'the value in BUSINESS_INFO is the correct one — the narrative text is outdated. ' +
        'Answer from BUSINESS_INFO and never repeat the outdated value.',
        `When a field is ${NOT_PROVIDED}, you MUST NOT invent a value. ` +
        'Politely decline in the merchant\'s brand voice and offer an alternative ' +
        'channel if available (e.g. "we don\'t have a public phone — please visit ' +
        'us at <address>" or "I\'m here in chat — what can I help with?").',
        '',
        ...fieldLines,
    ];

    return sections.join('\n');
}
