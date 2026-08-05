import { integrationRegistry } from '../../integrations';
import { getStoreContextForAI } from '../ecommerce';
import { catalogService } from '../catalog';
import { factCollectionsService } from '../factCollections';
import { captureError } from '../../utils/sentryHelpers';
import { formatBusinessProfile } from '../../utils/businessProfile';
import { detectLanguageCode } from '../../utils/language';
import {
    formatBusinessInfoPrompt,
    unwrapBusinessProfile,
    normalizeDirectives,
    type StoredBusinessProfile,
    type MerchantDirective,
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
    /**
     * G1a: the merchant's enumerable LIST facts (outlets, coverage areas,
     * delivery zones) rendered as a prompt block, each list carrying its own
     * DERIVED coverage/absence statement. Undefined when the page has no
     * collections — which is every page until one is imported, so the prompt
     * stays byte-identical for the rest of the fleet.
     *
     * Independent of `productCatalog`: catalog_items are things the business
     * SELLS (money semantics); collections are enumerable lists that are not
     * sold. A page can have both, either, or neither.
     */
    factCollectionsBlock: string | undefined;
    /**
     * True when the deterministic match withheld row detail for at least one
     * collection, i.e. this reply's list content is specific to THIS message.
     *
     * It exists to disable the SEMANTIC cache for such replies (review finding
     * C1): that cache matches by embedding similarity, and «وين نلقاكم في تلة
     * الريح؟» vs «… في عين الدالية؟» sit far inside the 0.91 LOCATION threshold —
     * two questions with different correct answers and nearly identical wording.
     * Serving one for the other would hand back real outlets under the wrong area,
     * which is the exact defect this whole path removes. The exact-text cache is
     * unaffected: identical text matches identical rows.
     */
    factCollectionsGated: boolean;
    /**
     * The merchant's standing ORDERS — instructions, not facts. Empty for every page
     * that has none, which is every page until one is authored, so the prompt stays
     * byte-identical for the rest of the fleet.
     *
     * Kept separate from `businessInfoBlock` and the narrative because the difference is
     * behavioural, not cosmetic: a fact informs an answer, an order REPLACES the model's
     * judgement about how to answer. Buried in the free text it reads as background, and
     * the model talks itself out of it.
     */
    directives: MerchantDirective[];
}

/**
 * Enrich the AI context for a page+settings combination.
 * Shared by comment and message pipelines — keeps both in sync.
 *
 * Steps:
 *  1. Integration KB enrichment (e.g. Shopify product summaries injected into KB)
 *  2. Store policies + product catalog (survive RAG which drops static KB)
 *  2b. Enumerable list facts + their derived coverage statements (also survive RAG)
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
    /**
     * Text the fact-collections matcher should read, when it differs from
     * `messageText`. The DM pipeline passes the CONSOLIDATED burst: a customer who
     * writes «أنا ساكن في عين الدالية» and then «وين نلقاكم؟» seconds later would
     * otherwise match nothing on the second message, and their own area's rows
     * would be withheld from a page that covers them (review finding H2).
     * `messageText` stays the brand-voice / language signal — unchanged.
     */
    matchText?: string,
): Promise<EnrichedContext> {
    let knowledgeBase = initialKnowledgeBase;

    // 1. Integration KB enrichment
    for (const integration of integrationRegistry.getEnabled()) {
        try {
            const enriched = await integration.enrichKnowledgeBase(knowledgeBase, page);
            if (enriched !== null) { knowledgeBase = enriched; break; }
        } catch { /* non-critical — continue with original KB */ }
    }

    // 2 + 2b. Two INDEPENDENT reads, run concurrently (Rule 17: independent I/O in
    // the reply path belongs in Promise.all) — the store/catalog block and the
    // fact-collections block need nothing from each other. Each closure keeps its
    // own catch, so one failing degrades exactly as it did when awaited serially.
    let storePolicies: string | undefined;
    let productCatalog: string | undefined;
    let factCollectionsBlock: string | undefined;
    let factCollectionsGated = false;
    const ecommerceStoreId = typeof page.ecommerceStoreId === 'string' ? page.ecommerceStoreId : undefined;
    const pageId = typeof page.id === 'string' ? page.id : undefined;
    await Promise.all([
        // 2. Store policies + product catalog (survive RAG mode which drops static KB)
        (async () => {
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
        })(),
        // 2b. Enumerable LIST facts (G1a) — outlets, coverage areas, delivery zones.
        //     NOT gated on the store branch: a list is orthogonal to whether the
        //     page sells online, and BAMBO LIBYA (the measured worst page: 22/79 replies
        //     fabricated, 17 of them availability-by-city) is store-less. The block
        //     carries its own derived coverage statement — the measured 28%→0%
        //     mechanism — so it must reach the model on every reply, RAG or not.
        (async () => {
            if (!pageId) return;
            try {
                // ONE pass builds both: the rendered list and the deterministic match of
                // this message against its key values. The match is the L2 stage — the
                // model is never asked whether «سوق الثلاثاء» is «سوق الخميس»; code
                // answers that from the rows, and in the default 'gated' mode the answer
                // decides which rows the model is shown at all.
                const facts = await factCollectionsService.buildFactCollectionsContext(pageId, matchText ?? messageText);
                factCollectionsBlock = facts.block;
                factCollectionsGated = facts.gated;
            } catch (err) {
                // Non-critical for delivering a reply, but never silent: a persistent
                // failure here silently removes the coverage statement, and the reply
                // then answers absence questions from the bare list again — the exact
                // fabrication this block exists to prevent, with no signal.
                captureError(err, 'Fact collections prompt block failed', { level: 'warning', tags: { service: 'factCollections' }, extra: { pageId } });
            }
        })(),
    ]);

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

    // 3c. The merchant's standing ORDERS, read from the same page-level home as his other
    //     page-wide facts. Kept apart from the narrative on purpose: mashed into the free
    //     text an order reads as background, and the model talks itself out of following
    //     it (prod, الفريق الدمشقي 2026-08-04 — invented a lab curriculum where his own
    //     text said to route the question to the phone). `normalizeDirectives` is tolerant
    //     because this is merchant-editable JSON: one bad row must never break replies.
    const directives = normalizeDirectives(
        (merchant as { directives?: unknown } | undefined)?.directives,
    );

    // 4. Language-appropriate brand voice notes
    const brandVoiceNotes = resolveBrandVoiceNotes(userSettings, messageText);

    return { knowledgeBase, storePolicies, productCatalog, brandVoiceNotes, ecommerceStoreId, businessInfoBlock, factCollectionsBlock, factCollectionsGated, directives };
}

/**
 * Pick the brand-voice notes matching the customer message's language.
 *
 * Single source of truth for the selection rule — used by enrichPageContext
 * (production replies) AND scripts/warm-reply-cache.ts (post-deploy cache
 * warming). Brand voice is a cache-key segment (`bv:`), so the warm path must
 * resolve it exactly like production or warmed entries land under unread keys.
 */
export function resolveBrandVoiceNotes(
    userSettings: {
        brandVoiceNotesMulti?: Record<string, string> | unknown;
        brandVoiceNotes?: string;
        supportedLanguages?: unknown;
    },
    messageText: string,
): string | undefined {
    const bvMulti = (userSettings.brandVoiceNotesMulti || {}) as Record<string, string>;
    const lang = detectLanguageCode(messageText);
    const supportedLangs = (userSettings.supportedLanguages as string[] | undefined) || ['ar', 'en'];
    // Only fall back to the legacy brandVoiceNotes text column if brandVoiceNotesMulti has
    // never been written (i.e. it has no keys). Once the user has used the new UI, the multi
    // column is authoritative — falling back to the old column would resurrect cleared values.
    const legacyFallback = Object.keys(bvMulti).length === 0 ? userSettings.brandVoiceNotes : undefined;
    return bvMulti[lang]
        || supportedLangs.map(l => bvMulti[l]).find(Boolean)
        || legacyFallback
        || undefined;
}
