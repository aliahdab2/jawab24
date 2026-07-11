import { z } from 'zod';
import { MAX_CATALOG_IMPORT_CHARS, MAX_CATALOG_ITEMS_PER_PAGE } from '@jawab24/shared';

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
     * Empty string entries stripped server-side; nulls and undefined dropped. */
    phones: z.array(z.string().min(3).max(40)).max(10).optional(),
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
        whatsapp: z.string().max(50).optional(),
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

// ==========================================
// Native catalog (merchant-authored offerings)
// ==========================================

/**
 * Accept a price however a merchant naturally types it (Simplicity contract §5):
 * Arabic-Indic digits (٣٥٠٠), Eastern separators (٫ decimal / ٬ thousands),
 * Western separators, or a plain number — normalized before numeric validation.
 * null/'' = "price on request".
 *
 * Comma disambiguation (M4, PR #407): a single comma followed by exactly 1–2
 * digits is a DECIMAL comma ("3,50" → 3.50 — common comma-as-decimal habit),
 * anything else treats commas as thousands separators ("3,500" → 3500,
 * "1,234,567" → 1234567). Mis-reading "3,50" as 350 would send a 100× wrong
 * price to customers.
 */
const PriceInput = z.preprocess((raw) => {
    if (raw === null || raw === undefined || raw === '') return null;
    if (typeof raw === 'number') return raw;
    if (typeof raw !== 'string') return raw; // let z.number() reject it
    let normalized = raw
        .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
        .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
        .replace(/٫/g, '.')
        .trim();
    if (/^\d+,\d{1,2}$/.test(normalized)) {
        normalized = normalized.replace(',', '.');
    } else {
        normalized = normalized.replace(/[,٬\s]/g, '');
    }
    const num = Number(normalized);
    return Number.isFinite(num) ? num : raw; // unparseable → fails z.number() with a clear error
}, z.number().min(0, 'Price must be non-negative').max(9_999_999_999.99).nullable());

export const CatalogItemSchema = z.object({
    type: z.enum(['product', 'service', 'course', 'vehicle', 'custom']).default('product'),
    name: z.string().trim().min(1, 'Name is required').max(200),
    description: z.string().trim().max(600).nullable().optional()
        .transform(v => (v === '' ? null : v ?? null)),
    price: PriceInput.optional().transform(v => v ?? null),
    currency: z.string().trim().max(10).nullable().optional()
        .transform(v => (v === '' ? null : v ?? null)),
    isAvailable: z.boolean().default(true),
});

/** PATCH body: any subset of the create fields, plus list reordering.
 *  '' → null mirrors the create schema so an update can't store empty strings
 *  (omitted fields stay undefined = unchanged). */
export const CatalogItemUpdateSchema = z.object({
    type: z.enum(['product', 'service', 'course', 'vehicle', 'custom']).optional(),
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(600).nullable().optional()
        .transform(v => (v === '' ? null : v)),
    price: PriceInput.optional(),
    currency: z.string().trim().max(10).nullable().optional()
        .transform(v => (v === '' ? null : v)),
    isAvailable: z.boolean().optional(),
    sortOrder: z.number().int().min(0).optional(),
}).refine(body => Object.keys(body).length > 0, { message: 'At least one field is required' });

export type CatalogItemInput = z.infer<typeof CatalogItemSchema>;
export type CatalogItemUpdateInput = z.infer<typeof CatalogItemUpdateSchema>;

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

