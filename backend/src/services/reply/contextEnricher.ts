import { integrationRegistry } from '../../integrations';
import { getStoreContextForAI } from '../ecommerce';
import { formatBusinessProfile } from '../../utils/businessProfile';
import { detectLanguageCode } from '../../utils/language';

export interface EnrichedContext {
    knowledgeBase: string | undefined;
    storePolicies: string | undefined;
    productCatalog: string | undefined;
    brandVoiceNotes: string | undefined;
    ecommerceStoreId: string | undefined;
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
    if (ecommerceStoreId) {
        try {
            const storeCtx = await getStoreContextForAI(ecommerceStoreId);
            storePolicies = storeCtx.storePolicies;
            productCatalog = storeCtx.productCatalog;
        } catch { /* non-critical */ }
    }

    // 3. Append business profile (hours, location, phone) to KB
    const profileText = formatBusinessProfile(page.businessProfile as Record<string, unknown> | null | undefined);
    if (profileText) {
        knowledgeBase = knowledgeBase
            ? `${knowledgeBase}\n\n--- Business Info ---\n${profileText}`
            : profileText;
    }

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

    return { knowledgeBase, storePolicies, productCatalog, brandVoiceNotes, ecommerceStoreId };
}
