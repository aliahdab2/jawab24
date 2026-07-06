import { integrationRegistry } from '../../integrations';
import { getStoreContextForAI } from '../ecommerce';
import { catalogService } from '../catalog';
import { captureError } from '../../utils/sentryHelpers';
import { formatBusinessProfile } from '../../utils/businessProfile';
import { detectLanguageCode } from '../../utils/language';
import {
    formatBusinessInfoPrompt,
    unwrapBusinessProfile,
    type StoredBusinessProfile,
} from '@jawab24/shared';

export interface EnrichedContext {
    knowledgeBase: string | undefined;
    storePolicies: string | undefined;
    productCatalog: string | undefined;
    brandVoiceNotes: string | undefined;
    ecommerceStoreId: string | undefined;
    /**
     * Stage 2.6 structured BUSINESS_INFO block. Built from `business_profile.merchant`
     * only — never from FB suggestions. The AI prompt injects this verbatim so
     * stale FB phone/address data cannot reach the [NOT_PROVIDED] / authoritative
     * surface. Null when the merchant has no confirmed fields yet (then the
     * AI falls back to merged narrative KB via `formatBusinessProfile`).
     */
    businessInfoBlock: string | null;
}

/**
 * Enrich the AI context for a page+settings combination.
 * Shared by comment and message pipelines — keeps both in sync.
 *
 * Steps:
 *  1. Integration KB enrichment (e.g. Shopify product summaries injected into KB)
 *  2. Store policies + product catalog (survive RAG which drops static KB)
 *  3. Business profile (hours, location, phone) appended to KB
 *  4. Language-appropriate brand voice notes
 */
export async function enrichPageContext(
    page: Record<string, unknown>,
    userSettings: {
        brandVoiceNotesMulti?: Record<string, string> | unknown;
        brandVoiceNotes?: string;
        supportedLanguages?: unknown;
    },
    messageText: string,
    initialKnowledgeBase: string | undefined,
): Promise<EnrichedContext> {
    let knowledgeBase = initialKnowledgeBase;

    // 1. Integration KB enrichment
    for (const integration of integrationRegistry.getEnabled()) {
        try {
            const enriched = await integration.enrichKnowledgeBase(knowledgeBase, page);
            if (enriched !== null) { knowledgeBase = enriched; break; }
        } catch { /* non-critical — continue with original KB */ }
    }

    // 2. Store policies + product catalog (survive RAG mode which drops static KB)
    let storePolicies: string | undefined;
    let productCatalog: string | undefined;
    const ecommerceStoreId = typeof page.ecommerceStoreId === 'string' ? page.ecommerceStoreId : undefined;
    const pageId = typeof page.id === 'string' ? page.id : undefined;
    if (ecommerceStoreId) {
        try {
            const storeCtx = await getStoreContextForAI(ecommerceStoreId);
            storePolicies = storeCtx.storePolicies;
            productCatalog = storeCtx.productCatalog;
        } catch { /* non-critical */ }
    } else if (pageId) {
        // Store-less pages: merchant-authored catalog_items fill the same
        // <product_catalog> block (Stage 2 v2 — prompt content, never AI tools;
        // D-004). undefined when the page has no items, so the prompt stays
        // byte-identical for every page without a catalog.
        try {
            productCatalog = await catalogService.buildCatalogPromptBlock(pageId);
        } catch (err) {
            // Non-critical — the reply proceeds without the catalog block. But
            // never silently: a persistent failure here means catalogs vanish
            // from prompts fleet-wide ("the AI ignores my items") with no signal.
            captureError(err, 'Catalog prompt block failed', { level: 'warning', tags: { service: 'catalog' }, extra: { pageId } });
        }
    }

    // 3a. Narrative business profile appended to KB. DESCRIPTIVE fields only
    //     (business type, about, website) — operational facts (hours/phone/
    //     address/channels) are NOT emitted here (D-010): this is the merged
    //     merchant ∪ suggestions half, i.e. unconfirmed Facebook data, and a
    //     stale FB value stated as fact (Friday "00:00-23:45" = FB "open all
    //     day") sent customers to a closed business. Operational facts reach the
    //     model ONLY through the gated BUSINESS_INFO block below.
    const profileText = formatBusinessProfile(page.businessProfile as Record<string, unknown> | null | undefined);
    if (profileText) {
        knowledgeBase = knowledgeBase
            ? `${knowledgeBase}\n\n--- Business Info ---\n${profileText}`
            : profileText;
    }

    // 3b. Stage 2.6 structured BUSINESS_INFO block — built from `merchant` only,
    //     never FB suggestions. Beats stale narrative chunks via the "structured
    //     > narrative" precedence (Eval Case #19) and refuses to invent missing
    //     fields via [NOT_PROVIDED] markers (Damascus phone regression case #11).
    //     PROVENANCE-GATED (D-008/D-010): only merchant-authored, CONFIRMED facts
    //     are authoritative — `fb_sync` AND unconfirmed `editor`/`confirmedAt:null`
    //     (the legacy auto-stamp that mislabels FB-synced data) are demoted, so
    //     Facebook can never override or state the hours/phone the merchant put
    //     in their KB. KB has it → KB wins; KB silent → deflect, never Facebook.
    const { merchant, merchantProvenance } = unwrapBusinessProfile(page.businessProfile as StoredBusinessProfile);
    const businessInfoBlock = formatBusinessInfoPrompt(merchant ?? null, merchantProvenance);

    // 4. Language-appropriate brand voice notes
    const bvMulti = (userSettings.brandVoiceNotesMulti || {}) as Record<string, string>;
    const lang = detectLanguageCode(messageText);
    const supportedLangs = (userSettings.supportedLanguages as string[] | undefined) || ['ar', 'en'];
    // Only fall back to the legacy brandVoiceNotes text column if brandVoiceNotesMulti has
    // never been written (i.e. it has no keys). Once the user has used the new UI, the multi
    // column is authoritative — falling back to the old column would resurrect cleared values.
    const legacyFallback = Object.keys(bvMulti).length === 0 ? userSettings.brandVoiceNotes : undefined;
    const brandVoiceNotes = bvMulti[lang]
        || supportedLangs.map(l => bvMulti[l]).find(Boolean)
        || legacyFallback
        || undefined;

    return { knowledgeBase, storePolicies, productCatalog, brandVoiceNotes, ecommerceStoreId, businessInfoBlock };
}
