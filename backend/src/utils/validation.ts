import { z } from 'zod';
import {
    CATALOG_VERTICALS, MAX_CATALOG_IMPORT_CHARS, MAX_CATALOG_ITEM_ATTRIBUTES, MAX_CATALOG_ITEMS_PER_PAGE,
    MAX_ROWS_PER_COLLECTION,
    MAX_LIST_LABEL_LENGTH,
    MAX_FACT_ATTR_VALUE_LENGTH,
    MAX_FACT_ATTR_LABEL_LENGTH,
    MAX_FACT_ROW_ATTRIBUTES,
    MAX_PHONE_DESCRIPTION_LENGTH,
    normalizePhoneEntries,
    isUsablePhoneEntry,
    parseMerchantPrice,
    MAX_EMAIL_ATTACHMENTS,
    MAX_EMAIL_ATTACHMENT_BYTES,
    MAX_EMAIL_ATTACHMENTS_TOTAL_BYTES,
    MAX_EMAIL_CC,
    ALLOWED_ATTACHMENT_EXTENSIONS,
    sniffAttachmentMime,
} from '@jawab24/shared';
import type { CatalogVertical, EmailComposerErrorCode } from '@jawab24/shared';

/**
 * Validation Schemas for API Requests
 * Using Zod for type-safe validation.
 *
 * Note: `UpdateSettingsSchema` has been promoted to `@jawab24/shared` so the
 * frontend can use the same schema for pre-submit validation. Import it from
 * there. `CreatePlanSchema`, `UpdatePlanSchema`, and `BusinessProfileSchema`
 * remain here pending the same promotion in follow-up PRs.
 */

// ==========================================
// Plans (Admin)
// ==========================================
export const CreatePlanSchema = z.object({
    name: z.string().min(1, 'Name is required').max(100),
    slug: z.string().min(1, 'Slug is required').max(50).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
    description: z.string().max(500).optional(),
    price: z.number().int().min(0, 'Price must be non-negative'),
    currency: z.string().length(3).default('USD'),
    interval: z.enum(['month', 'year']).default('month'),
    maxPages: z.number().int().min(1).nullable().optional(),
    maxAiRepliesPerMonth: z.number().int().min(0).nullable().optional(),
    facebookEnabled: z.boolean().default(true),
    instagramEnabled: z.boolean().default(true),
    whatsappEnabled: z.boolean().default(false),
    prioritySupport: z.boolean().default(false),
    trialDays: z.number().int().min(0).default(0),
    regionalPricing: z.record(z.string(), z.number()).optional(),
    isActive: z.boolean().default(true),
    isPublic: z.boolean().default(true),
    isDefault: z.boolean().default(false),
    sortOrder: z.number().int().default(0),
});

export const UpdatePlanSchema = CreatePlanSchema.partial();

// ==========================================
// Admin — Waitlist / broadcast email send
// ==========================================
/**
 * Body schema for POST /admin/waitlist/send-email.
 *
 * Safety caps preserved from the original inline schema:
 *   - emailIds:    max 5000 per request
 *   - extraEmails: max 500 per request
 * Audience defaults to 'waitlist' when omitted.
 */
/**
 * Admin-composed account-notice email to a single merchant (support console).
 * Deliberately narrower than SendEmailSchema — no audience/template/broadcast
 * fields; just a subject + body sent to one user by id (path param).
 */
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/** Decoded byte count of a base64 string, without allocating a Buffer. */
export function base64ByteLength(b64: string): number {
    const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
    return (b64.length / 4) * 3 - padding;
}

// C0 controls + DEL (+ double quote for filenames). A NUL in any admin-typed
// field would poison the jsonb audit write (Postgres jsonb rejects \\u0000
// outright, and the audit insert's failure is swallowed by design), so the
// email would send while its audit row silently never lands; a CRLF in a
// filename reaches Resend's MIME part-header assembly verbatim.
// eslint-disable-next-line no-control-regex
const CONTROL_OR_QUOTE_RE = /[\u0000-\u001f\u007f"]/;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
// C0 minus \t (09), \n (0a), \r (0d) — for MULTI-LINE text fields. The body
// guard must allow those three: the compose textarea is multi-line and the
// template renders body newlines as <br>. The first shipped version rejected
// \n and 400'd EVERY multi-paragraph email (prod incident
// JAWAB24-FRONTEND-33, caught on the first real invoice send). They are also
// perfectly legal in Postgres jsonb — only \u0000 is not — so allowing them
// does not reopen the audit-poisoning hole.
// eslint-disable-next-line no-control-regex
const CONTROL_EXCEPT_WHITESPACE_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const freeOfControlChars = (s: string): boolean => !CONTROL_RE.test(s);
const freeOfNonWhitespaceControlChars = (s: string): boolean => !CONTROL_EXCEPT_WHITESPACE_RE.test(s);

const EmailAttachmentSchema: z.ZodType<{ filename: string; content: string }> = z.object({
    // Basename only. A path separator here would let an admin-supplied name
    // reach a downstream consumer as a relative path; the filename is metadata,
    // never a filesystem target for us, but we refuse to emit one either way.
    filename: z
        .string()
        .trim()
        .min(1, 'Attachment filename is required')
        .max(200)
        .refine((n) => !CONTROL_OR_QUOTE_RE.test(n), 'Attachment filename must not contain control characters or quotes')
        .refine((n) => !n.includes('/') && !n.includes('\\') && n !== '.' && n !== '..', 'Attachment filename must not contain a path')
        .refine(
            (n) => (ALLOWED_ATTACHMENT_EXTENSIONS as readonly string[]).includes(n.split('.').pop()?.toLowerCase() ?? ''),
            `Attachment must be one of: ${ALLOWED_ATTACHMENT_EXTENSIONS.join(', ')}`,
        ),
    content: z
        .string()
        .min(1, 'Attachment content is required')
        // Reject a `data:` prefix explicitly — it is the single most likely
        // caller mistake (FileReader hands you one) and Resend fails opaquely.
        .refine((c) => !c.startsWith('data:'), 'Attachment content must be raw base64, without a data: prefix')
        .refine((c) => c.length % 4 === 0 && BASE64_RE.test(c), 'Attachment content must be valid base64')
        .refine((c) => base64ByteLength(c) <= MAX_EMAIL_ATTACHMENT_BYTES, `Each attachment must be ${MAX_EMAIL_ATTACHMENT_BYTES / 1024 / 1024}MB or smaller`),
});

export const SendMerchantEmailSchema = z.object({
    subject: z.string().trim().min(1, 'Subject is required').max(500)
        .refine(freeOfControlChars, 'Subject must not contain control characters'),
    body: z.string().trim().min(1, 'Body is required').max(20_000)
        .refine(freeOfNonWhitespaceControlChars, 'Body must not contain control characters'),
    cc: z.array(z.string().trim().email('Invalid CC address').max(255)).max(MAX_EMAIL_CC).optional(),
    bcc: z.array(z.string().trim().email('Invalid BCC address').max(255)).max(MAX_EMAIL_CC).optional(),
    attachments: z
        .array(EmailAttachmentSchema)
        .max(MAX_EMAIL_ATTACHMENTS, `At most ${MAX_EMAIL_ATTACHMENTS} attachments`)
        .refine(
            (list) => list.reduce((sum, a) => sum + base64ByteLength(a.content), 0) <= MAX_EMAIL_ATTACHMENTS_TOTAL_BYTES,
            `Attachments must total ${MAX_EMAIL_ATTACHMENTS_TOTAL_BYTES / 1024 / 1024}MB or less`,
        )
        // Magic-byte verification: the decoded bytes must BE what the filename
        // claims. Runs on the array (not per-item) so it executes after the
        // cheap shape/size refines; decodes only the signature bytes.
        .refine(
            (list) => list.every((a) => {
                const ext = a.filename.split('.').pop()?.toLowerCase() ?? '';
                const head = Uint8Array.from(Buffer.from(a.content.slice(0, 16), 'base64'));
                return sniffAttachmentMime(ext, head) !== null;
            }),
            'Attachment content does not match its file type',
        )
        .optional(),
    // Client-minted, forwarded to Resend as an Idempotency-Key header so a
    // retry after an ambiguous failure (timeout after server receipt) cannot
    // deliver the same invoice twice. Optional: raw API callers may omit it.
    idempotencyKey: z.string().trim().min(8).max(256).optional(),
});

/**
 * Map the first Zod issue to a stable machine-readable code so the modal can
 * select its already-translated message instead of showing a generic
 * "try again" for a deterministic 400. Keyed on issue path + message content —
 * the messages above are the single source of both the human string and the
 * classification.
 */
export function sendMerchantEmailErrorCode(issue: z.ZodIssue): EmailComposerErrorCode {
    const root = issue.path[0];
    if (root === 'cc' || root === 'bcc') {
        return issue.code === 'too_big' ? 'EMAIL_RECIPIENTS_TOO_MANY' : 'EMAIL_RECIPIENT_INVALID';
    }
    if (root === 'attachments') {
        if (issue.code === 'too_big') return 'EMAIL_ATTACHMENTS_TOO_MANY';
        const msg = issue.message;
        if (msg.includes('or smaller')) return 'EMAIL_ATTACHMENT_TOO_LARGE';
        if (msg.includes('total')) return 'EMAIL_ATTACHMENTS_TOTAL_TOO_LARGE';
        if (msg.includes('must be one of')) return 'EMAIL_ATTACHMENT_BAD_TYPE';
        return 'EMAIL_ATTACHMENT_BAD_CONTENT';
    }
    return 'EMAIL_FIELDS_INVALID';
}

export const SendEmailSchema = z.object({
    subject: z.string().trim().min(1, 'Subject is required').max(500),
    body: z.string().trim().min(1, 'Body is required').max(100_000),
    feature: z.string().trim().min(1).max(50).optional(),
    emailIds: z.array(z.string().uuid()).max(5000).optional(),
    extraEmails: z.array(z.string().email().max(255)).max(500).optional(),
    audience: z.enum(['waitlist', 'users', 'both', 'extras']).optional().default('waitlist'),
    // Optional: render a full-HTML template (e.g. waitlist-launch) instead of
    // wrapping `body` in the generic shell. When set, each recipient receives
    // the AR or EN htmlBody variant matching their resolved language
    // (KB → dashboardLanguage → 'ar'). `subject` is still admin-controlled,
    // `body` is kept as a fallback for recipients whose variant is missing.
    templateId: z.string().trim().min(1).max(100).optional(),
});

export type SendEmailInput = z.infer<typeof SendEmailSchema>;

// ==========================================
// Business Profile
// ==========================================
export const BusinessProfileSchema = z.object({
    name: z.string().max(255).optional(),
    category: z.string().max(255).optional(),
    about: z.string().max(2000).optional(),
    /** @deprecated Stage 2.6 — use `phones[]`. Coerced on next FB sync. */
    phone: z.string().max(50).optional(),
    /** Stage 2.6 — ordered list of contact numbers. Primary first.
     * Empty string entries stripped server-side; nulls and undefined dropped.
     *
     * An entry may carry a free-text `description` of what the line is for
     * («الإدارة — عند الطلب فقط»). The preprocess canonicalizes BEFORE the
     * shape is validated, which is what makes the stored value a pure function
     * of (number, description) — see the canonical-form invariant in
     * `businessPhone.ts`. Without it, a shape flip on the editor's
     * full-replace echo would stamp merchant provenance on an untouched
     * Facebook-synced number. */
    // ⭐ PREPROCESS, not `.transform()`. Zod runs a transform AFTER validation,
    // which made the comment above a lie and had a real cost: a 41-character
    // description hit `max(MAX_PHONE_DESCRIPTION_LENGTH)` and returned 400,
    // instead of `sanitizePhoneDescription` truncating it to 40 — contradicting
    // that function's own contract ("everything here REPLACES rather than
    // rejects; a merchant must never be blocked from saving over punctuation").
    // Canonicalizing FIRST also means the length and digit bounds below are
    // checked against the value that will actually be STORED, not the raw one:
    // « 12 » is now correctly rejected on its 2 trimmed digits rather than
    // passing on 6 raw characters.
    //
    // `undefined` must pass straight through. Sending it to normalizePhoneEntries
    // would return `[]`, turning "this patch does not mention phones" into
    // "clear the phones" — and since the editor sends a full-replace patch, that
    // is the difference between leaving a field alone and wiping it.
    phones: z.preprocess(
        (v) => (v === undefined ? undefined : normalizePhoneEntries(v)),
        z.array(z.union([
            z.string().min(3).max(40),
            z.object({
                number: z.string().min(3).max(40),
                description: z.string().max(MAX_PHONE_DESCRIPTION_LENGTH).optional(),
            }).strict(),
        ])).max(10).optional(),
    ),
    /** The business's contact email (schema.org `ContactPoint.email`). Strict
     *  validation is safe here because no producer wrote this field before it
     *  existed — there is no legacy garbage for a full-replace echo to trip on.
     *  254 = the RFC 5321 forward-path maximum. */
    email: z.union([
        // Clearing the field in the editor sends '' — that is "unset", not a
        // malformed address, so it must not 400.
        z.literal(''),
        z.string().trim().email().max(254),
    ]).optional().transform((v) => (v ? v : undefined)),
    website: z.string().max(500).optional(),
    address: z.string().max(500).optional(), // widened from 255 — Damascus-style multi-line addresses overflowed
    city: z.string().max(100).optional(),
    country: z.string().max(100).optional(),
    hours: z.record(
        z.string(),
        z.array(z.string().max(30))
    ).optional(),
    channels: z.object({
        preferred: z.enum(['dm', 'whatsapp', 'phone']).optional(),
        /** Legacy single string, or an array — any listed number can be on
         *  WhatsApp independently. Same per-entry bounds as `phones`. */
        whatsapp: z.union([
            z.string().max(50),
            z.array(z.string().min(3).max(40)).max(10),
        ]).optional(),
    }).optional(),
    language_hint: z.enum(['ar', 'en', 'auto']).optional(),
    /** Stage 2.6 — free-text policy fields, ≤500 chars each. Empty strings
     *  treated equivalently to "field not set" by the prompt-injection layer.
     *  Optional (undefined) at every level; we don't use null for clarity. */
    policies: z.object({
        shipping: z.string().max(500).optional(),
        returns: z.string().max(500).optional(),
        payment: z.string().max(500).optional(),
        booking: z.string().max(500).optional(),
    }).optional(),
}).passthrough(); // Allow extra fields from Facebook API without breaking

export type BusinessProfileInput = z.infer<typeof BusinessProfileSchema>;

/**
 * The merchant-editor boundary: everything above, PLUS the rule that a phone
 * slot must hold a phone.
 *
 * ⚠️ Deliberately a SEPARATE schema rather than a refinement on
 * `BusinessProfileSchema`, because that schema has a second caller —
 * `buildBusinessProfile` validates the FACEBOOK-SYNCED profile with it
 * (`services/pages.ts`), and a failure there reports to Sentry and returns the
 * profile unvalidated. Machine-sourced data must not be judged by a rule
 * written for merchant typing: a Facebook page whose `phone` libphonenumber
 * cannot resolve would spam Sentry on every sync and half-validate the result.
 *
 * The rejected class is narrow and real: a page stored
 * «رقم الجملة فقط يطلب مبيعات جملة» AS a phone number, editor-confirmed, and
 * every prompt then published it to customers as one. `isUsablePhoneEntry` is
 * the only judge — no keyword list, nothing language-specific. An entry that
 * DOES contain a number keeps saving even with prose beside it; that case is
 * redirected in the editor by a hint, never blocked, so no real contact line can
 * be locked out.
 *
 * ⚠️ That predicate deliberately does NOT reuse `extractPhones`. Doing so once
 * imported its 9-digit floor — correct for "is a phone hidden in this prose?",
 * wrong for "is this field's content a phone?" — and rejected a real 7-digit
 * landline, blocking every Business Info save for that merchant. See the note on
 * `isUsablePhoneEntry` in `@jawab24/shared`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⭐⭐ GRANDFATHERING, and why the predicate alone was not enough (review, 2026-08-13)
 *
 * The editor sends a FULL-REPLACE patch, so this schema re-judges every STORED
 * entry on every save. Making the predicate correct fixed the false rejects; it
 * did NOT fix the shape of the failure. One genuinely-bad stored entry still
 * 400s a save that only touched the address — and the merchant sees a generic
 * error naming nothing.
 *
 * That is not a data problem to be cleaned up once, because the bad entry does
 * not arrive through here. `buildBusinessProfile` writes Facebook-synced values
 * through the BASE schema **by design** (see above), the KB fact extractor does
 * the same, and a stored row can predate any version of this code. So the supply
 * of unvalidatable stored entries is CONTINUOUS, and a merchant can be locked
 * out of their own hours field by something Facebook wrote.
 *
 * The fix makes the lockout impossible rather than unlikely (Rule 14): an entry
 * whose number is ALREADY STORED on this page is grandfathered — it can be kept
 * or removed, but it can never block an unrelated edit. Only numbers the
 * merchant is genuinely ADDING or CHANGING are judged. Compared on the trimmed
 * number because the incoming value is canonicalized (trimmed) by the preprocess
 * above while the stored one may not be, and a padding difference must not read
 * as a new entry.
 *
 * ⚠️ Callers that have no prior state (machine producers, tests asserting the
 * strict rule) pass nothing and get the strict behaviour.
 */
export function merchantBusinessProfileSchema(storedNumbers: readonly string[] = []) {
    const grandfathered = new Set(storedNumbers.map((n) => n.trim()).filter(Boolean));
    return BusinessProfileSchema.superRefine((profile, ctx) => {
        const phones = profile.phones ?? [];
        phones.forEach((entry, i) => {
            const number = typeof entry === 'string' ? entry : entry.number;
            if (isUsablePhoneEntry(number)) return;
            // Already on the page ⇒ the merchant is not introducing it here.
            if (grandfathered.has(number.trim())) return;
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['phones', i],
                message: 'PHONE_ENTRY_NOT_A_NUMBER',
                // The offending text, so the client can name the row instead of
                // failing with a generic "save failed". It is the merchant's own
                // input echoed back to them.
                params: { value: number },
            });
        });
    });
}

// ==========================================
// Native catalog (merchant-authored offerings)
// ==========================================

/**
 * Accept a price however a merchant naturally types it (Simplicity contract §5).
 * The normalization itself lives in `parseMerchantPrice` (@jawab24/shared) so
 * the editor can refuse the same strings this schema rejects, INLINE, instead
 * of the merchant discovering it as a 400 (owner report, 2026-08-10).
 *
 * Unparseable text is passed through untouched so `z.number()` produces the
 * error — the client maps the code, never this developer string.
 */
const PriceInput = z.preprocess((raw) => {
    const parsed = parseMerchantPrice(raw);
    return parsed.ok ? parsed.value : raw;
}, z.number().min(0, 'Price must be non-negative').max(9_999_999_999.99).nullable());

/** Currency label as the merchant or extractor writes it next to the price — a
 *  symbol ($), a short code (EGP), or a spelled-out name that may carry a qualifier
 *  the region depends on ("ل.س بالعملة القديمة" — Syria's old-vs-new lira is a 100×
 *  distinction, so the qualifier is load-bearing, not noise). Lenient by the same
 *  contract as PriceInput and the date/attribute sanitizers: an over-long value is
 *  TRUNCATED to the cap, NEVER rejected. Currency must never be the field that sinks
 *  an otherwise-valid item — the original 10-char hard cap silently dropped every
 *  single row of an Arabic price list whose currency read "ل.س بالعملة القديمة".
 *  ''/undefined → null ("no currency"). */
const CATALOG_CURRENCY_MAX = 30;
const CurrencyInput = z.preprocess((raw) => {
    if (raw === null || raw === undefined) return null;
    if (typeof raw !== 'string') return raw; // non-string → let z.string() reject it
    const trimmed = raw.trim();
    if (trimmed === '') return null;
    return trimmed.length > CATALOG_CURRENCY_MAX ? trimmed.slice(0, CATALOG_CURRENCY_MAX) : trimmed;
}, z.string().max(CATALOG_CURRENCY_MAX).nullable());

/** True only for a date whose Y-M-D parts round-trip — "2026-13-45" fails
 *  instead of rolling over into a different month. Exported for the catalog
 *  extractor's pre-sanitize step (drop a bad date FIELD, not the whole row). */
export function isRealCalendarDate(s: string): boolean {
    const [y, m, d] = s.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** 'YYYY-MM-DD' calendar date (day granularity is the product semantics —
 *  course cohorts and offer expiries; DATE column, no timezone drift).
 *  ''/undefined → null = "not set". */
const CatalogDateInput = z.preprocess(
    (raw) => (raw === '' || raw === undefined ? null : raw),
    z.string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
        .refine(isRealCalendarDate, 'Invalid calendar date')
        .nullable(),
);

/** Label+value details. Lenient by design (the extractor and the form both
 *  feed this): non-string sides are coerced, blank rows dropped, overflow
 *  sliced to the cap — a bad detail must never sink the whole item.
 *  Parameterized because the two consumers cap differently: catalog attrs are
 *  chips on one prompt line (short value, 6 per item), fact-row attrs carry the
 *  entity editor's open note textarea (paragraph value, 12 per row — the form's
 *  own field cap; a lower server cap silently sliced off accepted fields). */
const makeAttributesInput = (maxValueLength: number, maxCount: number) => z.preprocess(
    (raw) => {
        if (raw === null || raw === undefined) return null;
        if (!Array.isArray(raw)) return raw; // let the array schema reject it
        const rows = raw
            .map((r) => {
                if (!r || typeof r !== 'object') return null;
                const { label, value } = r as { label?: unknown; value?: unknown };
                return {
                    label: typeof label === 'string' || typeof label === 'number' ? String(label).trim() : '',
                    value: typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '',
                };
            })
            .filter((r): r is { label: string; value: string } => !!r && r.label !== '' && r.value !== '')
            .slice(0, maxCount);
        return rows.length === 0 ? null : rows;
    },
    z.array(z.object({
        label: z.string().min(1).max(MAX_FACT_ATTR_LABEL_LENGTH),
        value: z.string().min(1).max(maxValueLength),
    })).max(maxCount).nullable(),
);
const CatalogAttributesInput = makeAttributesInput(100, MAX_CATALOG_ITEM_ATTRIBUTES);
const FactAttributesInput = makeAttributesInput(MAX_FACT_ATTR_VALUE_LENGTH, MAX_FACT_ROW_ATTRIBUTES);

export const CatalogItemSchema = z.object({
    type: z.enum(['product', 'service', 'course', 'vehicle', 'custom']).default('product'),
    name: z.string().trim().min(1, 'Name is required').max(200),
    description: z.string().trim().max(600).nullable().optional()
        .transform(v => (v === '' ? null : v ?? null)),
    price: PriceInput.optional().transform(v => v ?? null),
    currency: CurrencyInput.optional().transform(v => v ?? null),
    isAvailable: z.boolean().default(true),
    startsAt: CatalogDateInput.optional().transform(v => v ?? null),
    endsAt: CatalogDateInput.optional().transform(v => v ?? null),
    attributes: CatalogAttributesInput.optional().transform(v => v ?? null),
}).refine(
    (item) => !item.startsAt || !item.endsAt || item.endsAt >= item.startsAt,
    { message: 'End date must not be before the start date', path: ['endsAt'] },
);

/** PATCH body: any subset of the create fields, plus list reordering.
 *  '' → null mirrors the create schema so an update can't store empty strings
 *  (omitted fields stay undefined = unchanged). Cross-field date order is NOT
 *  checked here (a partial update can't see the other date) — the UI validates
 *  it, and the prompt renderer tolerates an inverted pair. */
export const CatalogItemUpdateSchema = z.object({
    type: z.enum(['product', 'service', 'course', 'vehicle', 'custom']).optional(),
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(600).nullable().optional()
        .transform(v => (v === '' ? null : v)),
    price: PriceInput.optional(),
    currency: CurrencyInput.optional(),
    isAvailable: z.boolean().optional(),
    startsAt: CatalogDateInput.optional(),
    endsAt: CatalogDateInput.optional(),
    attributes: CatalogAttributesInput.optional(),
    sortOrder: z.number().int().min(0).optional(),
}).refine(body => Object.keys(body).length > 0, { message: 'At least one field is required' });

export type CatalogItemInput = z.infer<typeof CatalogItemSchema>;
export type CatalogItemUpdateInput = z.infer<typeof CatalogItemUpdateSchema>;

/**
 * Fact-collection row bodies (G1b list editor). Reuses the catalog primitives
 * on purpose — same money normalization (Arabic-Indic digits), same varchar(10)
 * currency clamp, same YYYY-MM-DD calendar-checked dates, same attribute-pair
 * hygiene — so a value that is valid in one structured store is valid in the
 * other and vice versa.
 */
/** "HH:MM", 24-hour — exactly what `<input type="time">` emits. */
const TimeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be HH:MM');

/**
 * Structured SHADOW of an attribute value (round-7 write-back contract). The
 * attribute STRING stays the merchant-visible truth the AI quotes; the shadow
 * is the machine form the editor generated it from. Keyed by attribute label,
 * same cap as the attribute list itself.
 */
const StructuredFieldValue = z.discriminatedUnion('kind', [
    z.object({
        kind: z.literal('weekdays'),
        days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    }),
    z.object({ kind: z.literal('timeRange'), start: TimeOfDay, end: TimeOfDay }),
]);
export const FactStructuredValuesInput = z
    .record(z.string().trim().min(1).max(60), StructuredFieldValue)
    .refine(v => Object.keys(v).length <= 12, { message: 'At most 12 structured fields' });

const FactRowFields = {
    name: z.string().trim().min(1, 'Name is required').max(200),
    attributes: FactAttributesInput.optional().transform(v => v ?? null),
    structured: FactStructuredValuesInput.nullable().optional().transform(v => (v && Object.keys(v).length ? v : null)),
    price: PriceInput.optional().transform(v => v ?? null),
    currency: CurrencyInput.optional().transform(v => v ?? null),
    startsAt: CatalogDateInput.optional().transform(v => v ?? null),
    endsAt: CatalogDateInput.optional().transform(v => v ?? null),
    isAvailable: z.boolean().default(true),
};
const factRowDateOrder = {
    check: (row: { startsAt?: string | null; endsAt?: string | null }) =>
        !row.startsAt || !row.endsAt || row.endsAt >= row.startsAt,
    opts: { message: 'End date must not be before the start date', path: ['endsAt'] as (string | number)[] },
};

export const FactRowSchema = z.object(FactRowFields)
    .refine(factRowDateOrder.check, factRowDateOrder.opts);

/**
 * Sparse row fields — the merge vocabulary shared by the row PATCH and the
 * entity save's update case: an omitted key = unchanged, an explicit `null` =
 * clear. No defaults and no `?? null` transforms on purpose: either would turn
 * "not sent" into a write, which is exactly how the entity save used to wipe
 * fields the editor did not display (issue #671, the #670 data loss).
 */
const FactRowSparseFields = {
    name: z.string().trim().min(1).max(200).optional(),
    attributes: FactAttributesInput.optional(),
    /** An EMPTY shadow map means "no shadow" — normalize {} to an explicit
     *  clear so jsonb never stores a meaningless {} (absence still passes
     *  through untouched). */
    structured: FactStructuredValuesInput.nullable().optional()
        .transform(v => (v && Object.keys(v).length === 0 ? null : v)),
    price: PriceInput.optional(),
    currency: CurrencyInput.optional(),
    startsAt: CatalogDateInput.optional(),
    endsAt: CatalogDateInput.optional(),
    isAvailable: z.boolean().optional(),
};
const SPARSE_ROW_KEYS = Object.keys(FactRowSparseFields) as (keyof typeof FactRowSparseFields)[];

/**
 * One atomic save for a whole ENTITY (the single-form editor): row upserts and
 * deletes across a page's collections, applied in one transaction so a failed
 * session write can never strand a half-saved course. Caps sized to the form
 * (an entity is one base row + a handful of sessions), far below the
 * per-collection row cap the service enforces on top.
 *
 * Upserts MERGE, they do not replace (issue #671): with a `rowId`, an omitted
 * field is UNCHANGED and an explicit `null` clears — the row PATCH contract —
 * so no caller can wipe fields it did not display. Without a `rowId` the
 * upsert is an insert: a name is required, and the service fills the insert
 * defaults (omitted nullables → null, isAvailable → true).
 */
export const FactEntitySaveSchema = z.object({
    upserts: z.array(
        z.object({
            collectionId: z.string().uuid(),
            /** present = sparse update of that row; absent = insert a new one. */
            rowId: z.string().uuid().optional(),
            ...FactRowSparseFields,
        }).superRefine((u, ctx) => {
            if (!u.rowId && u.name === undefined) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['name'], message: 'Name is required' });
            }
            if (u.rowId && !SPARSE_ROW_KEYS.some((k) => u[k] !== undefined)) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'At least one field is required' });
            }
        }).refine(factRowDateOrder.check, factRowDateOrder.opts),
    ).max(40).default([]),
    deletes: z.array(z.object({
        collectionId: z.string().uuid(),
        rowId: z.string().uuid(),
    })).max(40).default([]),
}).refine(
    (body) => body.upserts.length + body.deletes.length > 0,
    { message: 'At least one operation is required' },
);

/** PATCH body: any subset; explicit null clears a nullable field. Built from
 *  the same sparse field map as the entity save's update case so the two merge
 *  contracts cannot drift apart. */
export const FactRowUpdateSchema = z.object(FactRowSparseFields)
    .refine(body => Object.keys(body).length > 0, { message: 'At least one field is required' });

/** PATCH completeness body — the merchant's word, tri-state (D-038):
 *  true = exhaustive (confident absence), false = declared partial,
 *  null = back to un-asked. */
export const FactCompletenessSchema = z.object({
    isComplete: z.boolean().nullable(),
});

/** The list's merchant-visible name. Cap mirrors fact_collections.label
 *  varchar(120); trimmed because the same string is the prompt block's header,
 *  where stray whitespace is what the model reads. ONE definition — create and
 *  rename must accept exactly the same names, or a list could be born with a
 *  label its own rename endpoint rejects. */
const FactCollectionLabelField = z.string().trim().min(1, 'Label is required').max(MAX_LIST_LABEL_LENGTH);

/**
 * POST /pages/:pageId/fact-collections — the merchant's «add list» (G1b).
 *
 * Deliberately narrower than the service's `CreateCollectionInput`:
 * - `keyAttr` is NOT accepted. The key drives reply-time row gating (L2) and
 *   the coverage index — a seeding/admin concern. Un-keyed lists answer fine
 *   (the MES showrooms precedent), so the merchant door never sets one.
 * - `source` is NOT accepted; the controller pins it to 'editor'.
 */
export const FactCollectionCreateSchema = z.object({
    label: FactCollectionLabelField,
    rows: z.array(FactRowSchema)
        .min(1, 'A collection needs at least one row')
        .max(MAX_ROWS_PER_COLLECTION, `At most ${MAX_ROWS_PER_COLLECTION} rows per collection`),
});

/** PATCH /pages/:pageId/fact-collections/:collectionId — rename only.
 *  keyAttr/source/isComplete stay out for the same reasons they are absent from
 *  the create body (completeness has its own endpoint, D-038). */
export const FactCollectionRenameSchema = z.object({
    label: FactCollectionLabelField,
});

export type FactRowBodyInput = z.infer<typeof FactRowSchema>;
export type FactEntitySaveBodyInput = z.infer<typeof FactEntitySaveSchema>;
export type FactRowUpdateBodyInput = z.infer<typeof FactRowUpdateSchema>;
export type FactCollectionCreateInput = z.infer<typeof FactCollectionCreateSchema>;

/** POST /pages/:pageId/catalog/extract body. Min 10 keeps accidental fragments
 *  from burning an LLM call; the max is the shared frontend/backend contract. */
export const CatalogExtractSchema = z.object({
    text: z.string().trim().min(10, 'Text too short to extract from').max(MAX_CATALOG_IMPORT_CHARS, `Text too long (max ${MAX_CATALOG_IMPORT_CHARS} characters)`),
});

/** POST /pages/:pageId/catalog/batch body: the reviewed import rows. Each item
 *  re-runs the full create schema (incl. PriceInput normalization) — the client
 *  may have edited rows after extraction. */
export const CatalogBatchSchema = z.object({
    items: z.array(CatalogItemSchema).min(1, 'At least one item is required').max(MAX_CATALOG_ITEMS_PER_PAGE),
});

/** PATCH /pages/:pageId/catalog/vertical body — merchant override of the
 *  derived business vertical. Enum from shared so a new vertical is one edit. */
export const CatalogVerticalSchema = z.object({
    vertical: z.enum(CATALOG_VERTICALS as [CatalogVertical, ...CatalogVertical[]]),
});

// ==========================================
// Generic ID Validation
// ==========================================
export const UUIDSchema = z.string().uuid('Invalid ID format');

export const PaginationSchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
});

// ==========================================
// Validation Helpers
// ==========================================

/**
 * Format Zod validation errors for API response
 */
export function formatValidationErrors(errors: z.ZodError): { field: string; message: string }[] {
    return errors.errors.map(err => ({
        field: err.path.join('.'),
        message: err.message,
    }));
}

/**
 * Validate and parse data with schema
 */
/**
 * Parse `data` and return either the validated value or formatted errors.
 *
 * Generic over OUTPUT and INPUT separately, with `In` defaulting to `Out` so
 * every existing caller is unaffected. The distinction matters for any schema
 * carrying a `z.preprocess` (e.g. `phones`, which canonicalizes before the shape
 * is checked): there Input ≠ Output, and the old `z.ZodSchema<T>` signature —
 * which is `ZodType<T, ZodTypeDef, T>`, i.e. "input equals output" — bound `T` to
 * the INPUT, so the returned `data` was typed as the raw shape rather than the
 * parsed one. Casting at the call site would have hidden that; this states it.
 */
export function validateSchema<Out, In = Out>(schema: z.ZodType<Out, z.ZodTypeDef, In>, data: unknown): { success: true; data: Out } | { success: false; errors: { field: string; message: string }[] } {
    const result = schema.safeParse(data);
    if (result.success) {
        return { success: true, data: result.data };
    }
    return { success: false, errors: formatValidationErrors(result.error) };
}

// ==========================================
// Manual invoices
// ==========================================

/**
 * A money field, in cents.
 *
 * The ceiling is 100,000,000 cents = 1,000,000 USD. Not a business limit — it
 * is a typo guard. Every amount here is hand-typed by an admin, and the failure
 * mode of a slipped decimal on a financial document sent to a customer is worse
 * than a rejected form. The floor is 0, not 1: a zero-rated line (a courtesy
 * period, a fully-discounted item) is legitimate, while a negative amount is a
 * credit note, which is a different document with different rules.
 */
const invoiceCents = z.number().int('Amounts must be whole cents').min(0).max(100_000_000);

export const CreateInvoiceSchema = z.object({
    lang: z.enum(['ar', 'en']),
    // The legal buyer, typed by the admin: usually the business, while the
    // account is a person. Never defaulted from users.name silently.
    customerName: z.string().trim().min(1, 'Customer name is required').max(255),
    customerContact: z.string().trim().max(255).optional(),
    customerEmail: z.string().trim().email('Invalid customer email').max(255).optional(),
    customerAddress: z.string().trim().max(1000).optional(),
    lineDescription: z.string().trim().min(1, 'A line description is required').max(500),
    lineDetail: z.string().trim().max(1000).optional(),
    quantityLabel: z.string().trim().min(1).max(64),
    // ISO strings on the wire, Dates in the service. Coerced here so the route
    // is the only place that knows about the transport format.
    periodStart: z.coerce.date().optional(),
    periodEnd: z.coerce.date().optional(),
    currency: z.string().trim().length(3, 'Currency must be a 3-letter code').toUpperCase(),
    subtotalCents: invoiceCents,
    vatCents: invoiceCents,
    planId: z.string().uuid().optional(),
    paymentNote: z.string().trim().max(500).optional(),
}).refine(
    (v) => (v.periodStart === undefined) === (v.periodEnd === undefined),
    { message: 'A billing period needs both a start and an end', path: ['periodEnd'] },
).refine(
    (v) => !v.periodStart || !v.periodEnd || v.periodEnd > v.periodStart,
    { message: 'The period end must be after its start', path: ['periodEnd'] },
);

/**
 * Sending an existing invoice. The attachment is NOT part of this input — the
 * server attaches the archived PDF by id. Letting a caller supply the file
 * would make "the invoice we sent" and "the invoice we stored" two different
 * things, which is the one property this whole register exists to guarantee.
 */
export const SendInvoiceSchema = z.object({
    subject: z.string().trim().min(1, 'Subject is required').max(500)
        .refine(freeOfControlChars, 'Subject must not contain control characters'),
    body: z.string().trim().min(1, 'Body is required').max(20_000)
        .refine(freeOfNonWhitespaceControlChars, 'Body must not contain control characters'),
    cc: z.array(z.string().trim().email('Invalid CC address').max(255)).max(MAX_EMAIL_CC).optional(),
    bcc: z.array(z.string().trim().email('Invalid BCC address').max(255)).max(MAX_EMAIL_CC).optional(),
    idempotencyKey: z.string().trim().min(8).max(256).optional(),
});

export const VoidInvoiceSchema = z.object({
    // Required, and required to be substantive: a void with no stated reason is
    // an unexplained hole in the register at audit time.
    reason: z.string().trim().min(3, 'A reason is required to void an invoice').max(500),
});

// ==========================================
// Export Types
// ==========================================
export type PaginationInput = z.infer<typeof PaginationSchema>;
export type CreateInvoiceInputDto = z.infer<typeof CreateInvoiceSchema>;
export type SendInvoiceInputDto = z.infer<typeof SendInvoiceSchema>;
export type CreatePlanInput = z.infer<typeof CreatePlanSchema>;
export type UpdatePlanInput = z.infer<typeof UpdatePlanSchema>;

