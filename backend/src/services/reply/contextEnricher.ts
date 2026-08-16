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

    // 4. Language-appropriate brand voice notes (page override → workspace default)
    const brandVoiceNotes = resolveBrandVoiceNotes(userSettings, messageText, page.brandVoiceNotesMulti);

    return { knowledgeBase, storePolicies, productCatalog, brandVoiceNotes, ecommerceStoreId, businessInfoBlock, factCollectionsBlock, factCollectionsGated };
}

/**
 * Pick the brand-voice notes matching the customer message's language.
 *
 * Single source of truth for the selection rule — used by enrichPageContext
 * (production replies) AND buildPlaygroundContext (playground / eval /
 * post-deploy cache warming). Brand voice is a cache-key segment (`bv:`), so
 * every path must resolve it exactly like production or warmed entries land
 * under unread keys.
 *
 * `pageOverride` is the page's own persona (`pages.brand_voice_notes_multi`,
 * D-084). When it carries any language content it is a PIN: the language pick
 * runs entirely within it — no workspace fallback and no legacy single-column
 * fallback, so a page persona can never be diluted by workspace text. The
 * `sourceLang` bookkeeping key and empty strings do not count as content:
 * NULL, {} and an all-cleared record all mean "inherit the workspace persona".
 */
export function resolveBrandVoiceNotes(
    userSettings: {
        brandVoiceNotesMulti?: Record<string, string> | unknown;
        brandVoiceNotes?: string;
        supportedLanguages?: unknown;
    },
    messageText: string,
    pageOverride?: Record<string, string> | unknown,
): string | undefined {
    const lang = detectLanguageCode(messageText);
    const supportedLangs = (userSettings.supportedLanguages as string[] | undefined) || ['ar', 'en'];
    const pick = (multi: Record<string, string>) =>
        multi[lang] || supportedLangs.map(l => multi[l]).find(Boolean);

    const { sourceLang: _overrideSource, ...overrideLangs } = (pageOverride || {}) as Record<string, string>;
    if (Object.values(overrideLangs).some(v => typeof v === 'string' && v.trim().length > 0)) {
        // Any-language tail: a page persona stored only in a language outside
        // supportedLanguages must still apply — the pin already suppressed the
        // workspace fallback, so dropping it here would silence the page
        // entirely rather than fall back.
        return pick(overrideLangs)
            || Object.values(overrideLangs).find(v => typeof v === 'string' && v.trim().length > 0)
            || undefined;
    }

    const bvMulti = (userSettings.brandVoiceNotesMulti || {}) as Record<string, string>;
    // Only fall back to the legacy brandVoiceNotes text column if brandVoiceNotesMulti has
    // never been written (i.e. it has no keys). Once the user has used the new UI, the multi
    // column is authoritative — falling back to the old column would resurrect cleared values.
    const legacyFallback = Object.keys(bvMulti).length === 0 ? userSettings.brandVoiceNotes : undefined;
    return pick(bvMulti)
        || legacyFallback
        || undefined;
}
