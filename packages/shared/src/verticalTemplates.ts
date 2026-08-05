/**
 * Vertical templates — a PROPOSED starting shape for a business type's data,
 * confirmed (and freely edited) by the merchant. Data, never code.
 *
 * WHY A TEMPLATE, AND WHY IT ONLY PROPOSES
 * ----------------------------------------
 * Extracting a merchant's knowledge into fact rows keeps dying on the same
 * question: WHICH attributes does this kind of business need on a row, which
 * facts belong to the page, and which sentences are standing orders? Answering
 * per-merchant reinvents the split every time (three designs died fitted to one
 * merchant's mess); answering with a fixed schema violates the settled ruling
 * that a vertical must never grow its own tables or required fields (see
 * CatalogVertical's contract in index.ts, D-052). The owner's ruling
 * (2026-08-05): a template PROPOSES the sector's usual shape, the merchant
 * confirms — the same consent model as `is_complete` on collections, where the
 * strong claim is earned from the merchant's word, never assumed.
 *
 * So everything in here is a suggestion for the extraction/onboarding step to
 * OFFER. Nothing reads a template at reply time; the reply path sees only what
 * the merchant actually confirmed (collections, page fields, directives).
 *
 * The first template (education/معهد) is derived from a real migrated
 * merchant — الفريق الدمشقي — whose three-collection split and directive set
 * are production-measured (fabrication ≈19% → ≈7%, 2026-08-04/05). The demo
 * fixture mirrors this template; `backend/test/plugins/demo-seed.test.ts` pins
 * the two against each other so they cannot drift apart.
 */
import type { CatalogVertical } from './index';

/** One suggested collection of fact rows (a list the sector usually keeps). */
export interface VerticalTemplateCollection {
    /** Display label, in the merchant's language («أسعار الدورات»). */
    label: string;
    /**
     * The attribute that names WHICH entity a customer is asking about
     * («الدورة»), or null for a list that always renders whole (a price table).
     * When set, it must also appear in `attributeLabels` — the coverage index
     * is computed from that attribute's values.
     */
    keyAttr: string | null;
    /** Suggested row-attribute labels, in display order. */
    attributeLabels: string[];
    /**
     * Rows carry startsAt/endsAt and drop out of the prompt when they pass
     * (cohort slots, offers). Exactly the self-expiry mechanism that killed
     * the stale-date class — expiry decided by code, never by the model.
     */
    selfExpiring: boolean;
}

/**
 * One suggested standing order (merchant directive). The template suggests the
 * TRIGGER SCOPE; the merchant writes the response himself — a template cannot
 * know his phone numbers, and pre-writing his words for him is how a wrong
 * default ships silently.
 */
export interface VerticalTemplateDirective {
    /** Suggested trigger keywords, Post Reply format (comma-separated). */
    keywords: string;
    /** Why this routing usually exists in the sector — shown next to the suggestion (فصحى). */
    hint: string;
}

export interface VerticalTemplate {
    vertical: CatalogVertical;
    /** What one row is, in the merchant's language («الدورة») — drives keyAttr suggestions. */
    entityNoun: string;
    collections: VerticalTemplateCollection[];
    /**
     * Page-level facts the sector needs confirmed (BusinessProfile merchant
     * keys; 'payment' lives under policies). Facts about the BUSINESS — never
     * forced onto entities.
     */
    pageFieldKeys: string[];
    directiveSuggestions: VerticalTemplateDirective[];
}

/**
 * قطاع «معهد تدريب» — the shape measured on الفريق الدمشقي.
 *
 * Three collections, and the split is load-bearing (documented at length in
 * backend/src/plugins/demo/damascusLists.ts):
 *   1. Prices — un-keyed, never expires: a course between cohorts is still a
 *      real course with a real price, so existence/price must not be asserted
 *      by an expiring list.
 *   2. Announced cohort slots — keyed by the course, one slot per row,
 *      self-expiring at the start date (the stale-date class, killed by data).
 *   3. The closed online list — keyed, tiny; the enumerated boundary is what
 *      stops a leading «دورة X أونلاين؟» from being affirmed.
 */
export const EDUCATION_TEMPLATE: VerticalTemplate = {
    vertical: 'education',
    entityNoun: 'الدورة',
    collections: [
        {
            label: 'أسعار الدورات',
            keyAttr: null,
            attributeLabels: ['المستوى', 'ملاحظة', 'المحاور', 'الأدوات'],
            selfExpiring: false,
        },
        {
            label: 'مواعيد الدورات المعلنة',
            keyAttr: 'الدورة',
            attributeLabels: ['الدورة', 'المستوى', 'الأيام', 'الساعة', 'ملاحظة'],
            selfExpiring: true,
        },
        {
            label: 'الدورات الأونلاين المتوفرة',
            keyAttr: 'الدورة',
            attributeLabels: ['الدورة'],
            selfExpiring: false,
        },
    ],
    pageFieldKeys: ['address', 'phones', 'hours', 'payment'],
    directiveSuggestions: [
        {
            // Deliberately NARROW: «مخبر» alone would swallow answerable questions
            // about a real lab course («قديش سعر دورة العمل المخبري») — the keyword
            // router's own bias applies: a silent false positive (a routed-away
            // answerable question) is worse than a silent miss.
            keywords: 'تحليلات, سحب الدم, مشافي',
            hint: 'الأسئلة الطبية والمخبرية (التحاليل، سحب الدم، التدريب في المشافي) تُوجَّه عادةً إلى التواصل المباشر — أكّد النطاق واكتب نص الردّ بنفسك.',
        },
        {
            keywords: 'التحويل من دورة, تحويل من دورة',
            hint: 'طلبات التحويل بين الدورات تحتاج قراراً من الإدارة، فتُوجَّه إلى التواصل المباشر.',
        },
    ],
};

/**
 * Registry — sparse on purpose. A vertical earns a template when a real
 * merchant's migration produces a measured shape, not before; a template
 * invented ahead of any merchant is the fixed-schema anti-pattern with
 * extra steps.
 */
export const VERTICAL_TEMPLATES: Partial<Record<CatalogVertical, VerticalTemplate>> = {
    education: EDUCATION_TEMPLATE,
};
