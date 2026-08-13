import { z } from 'zod';
import {
    CATALOG_VERTICALS, MAX_CATALOG_IMPORT_CHARS, MAX_CATALOG_ITEM_ATTRIBUTES, MAX_CATALOG_ITEMS_PER_PAGE,
    MAX_ROWS_PER_COLLECTION,
    MAX_LIST_LABEL_LENGTH,
    MAX_PHONE_DESCRIPTION_LENGTH,
    normalizePhoneEntries,
    isUsablePhoneEntry,
    parseMerchantPrice,
} from '@jawab24/shared';
import type { CatalogVertical } from '@jawab24/shared';

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
    showBranding: z.boolean().default(true),
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
export const SendMerchantEmailSchema = z.object({
    subject: z.string().trim().min(1, 'Subject is required').max(500),
    body: z.string().trim().min(1, 'Body is required').max(20_000),
});

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
    phones: z.array(z.union([
        z.string().min(3).max(40),
        z.object({
            number: z.string().min(3).max(40),
            description: z.string().max(MAX_PHONE_DESCRIPTION_LENGTH).optional(),
        }).strict(),
    ])).max(10).optional()
        // Canonicalize at the boundary — the server, not the client, decides
        // the stored shape. Also sanitizes each description (newlines out, so a
        // merchant cannot forge a BUSINESS_INFO field line).
        .transform((v) => (v === undefined ? undefined : normalizePhoneEntries(v))),
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
 * `isUsablePhoneEntry` in `@jawab24/shared`. Because the editor sends a
 * FULL-REPLACE patch, anything this schema rejects blocks a no-op save too, so a
 * false reject here is a lockout, never a warning.
 */
export const MerchantBusinessProfileSchema = BusinessProfileSchema.superRefine((profile, ctx) => {
    const phones = profile.phones ?? [];
    phones.forEach((entry, i) => {
        const number = typeof entry === 'string' ? entry : entry.number;
        if (!isUsablePhoneEntry(number)) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['phones', i],
                message: 'PHONE_ENTRY_NOT_A_NUMBER',
            });
        }
    });
});

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
 *  sliced to the cap — a bad detail must never sink the whole item. */
const CatalogAttributesInput = z.preprocess(
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
            .slice(0, MAX_CATALOG_ITEM_ATTRIBUTES);
        return rows.length === 0 ? null : rows;
    },
    z.array(z.object({
        label: z.string().min(1).max(30),
        value: z.string().min(1).max(100),
    })).max(MAX_CATALOG_ITEM_ATTRIBUTES).nullable(),
);

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
    attributes: CatalogAttributesInput.optional().transform(v => v ?? null),
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
    attributes: CatalogAttributesInput.optional(),
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
export function validateSchema<T>(schema: z.ZodSchema<T>, data: unknown): { success: true; data: T } | { success: false; errors: { field: string; message: string }[] } {
    const result = schema.safeParse(data);
    if (result.success) {
        return { success: true, data: result.data };
    }
    return { success: false, errors: formatValidationErrors(result.error) };
}

// ==========================================
// Export Types
// ==========================================
export type PaginationInput = z.infer<typeof PaginationSchema>;
export type CreatePlanInput = z.infer<typeof CreatePlanSchema>;
export type UpdatePlanInput = z.infer<typeof UpdatePlanSchema>;

