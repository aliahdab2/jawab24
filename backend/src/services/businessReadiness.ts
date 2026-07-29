/**
 * "Can Jawab ground a reply for this page on ANYTHING the merchant provided?"
 *
 * The gate behind auto-reply. A page with zero Business Info still produces
 * replies — `promptBuilder` simply omits `<business_knowledge>` and the model
 * answers a real customer with nothing to answer from. That is not a degraded
 * experience, it is the churn condition (drawingartsyria, D-024/025), and on the
 * WhatsApp-only connect path it was the DEFAULT: `createWhatsAppOnlyPage`
 * inserts `knowledge_base = NULL` / `business_profile = NULL` (there is no
 * Facebook page to seed from) and the client switched auto-reply on immediately
 * after. Prevention over detection (Rule 14) — refuse the enable instead of
 * shipping a warning next to a live, ungrounded bot.
 *
 * THE BAR IS "ANYTHING", NOT "COMPLETE". This is deliberately NOT the readiness
 * ring in `frontend/src/utils/businessCoverage.ts`: that scores five areas to
 * tell a merchant how much better they could do, and blocking on it would lock
 * out every partially-filled page on the fleet. The question here is only
 * whether the model receives a single grounded fact. Measured against
 * production before wiring (2026-07-29): 39 pages have auto-reply enabled and
 * ZERO of them fail this predicate, so the gate is invisible to existing
 * merchants and bites only the genuinely-empty page.
 *
 * ⚠️ KNOWN UNCOVERED PATH — `pagesService.syncPages`. A Facebook page is INSERTED
 * with `autoReplyEnabled: shouldAutoEnable` and `knowledgeBase:
 * suggestedKnowledgeBase || null`, so a page whose FB profile yields nothing
 * (no about / phone / hours / category / website) is born enabled AND
 * ungrounded without ever calling a toggle endpoint — this gate cannot see it.
 * Deliberately left alone for now: production has ZERO such rows (all 39
 * enabled pages are grounded, measured 2026-07-29), and moving the enable
 * decision would also move the `channelTrialService.record` / activation emits
 * that are keyed on `shouldAutoEnable`. Fix it there if a bare FB page ever
 * shows up enabled with nothing in it.
 *
 * ⚠️ NOT `isBusinessInfoProvided` (packages/shared/src/activation.ts). DO NOT
 * "unify" the two — they answer different questions and the difference is
 * load-bearing. That one gates the `kb_filled` ACTIVATION MILESTONE and asks
 * "did the merchant do the work?": ≥80 trimmed chars AND text that differs from
 * the Facebook auto-sync snapshot. A page still running the FB-generated KB
 * fails it — yet that KB grounds replies perfectly well. Measured on production
 * 2026-07-29: of the 39 pages with auto-reply enabled, `isBusinessInfoProvided`
 * would refuse 14 (36% of the working fleet), this predicate refuses 0. Wiring
 * the activation gate into the toggle would have been an outage.
 *
 * Each source below is a path that DEMONSTRABLY reaches the prompt, and each is
 * tested by calling the very formatter that renders it rather than by
 * re-deriving "is this field set?". Two independent answers to one question is
 * how a badge ends up contradicting the value printed beside it — the same trust
 * bug `businessCoverage.ts` was written to kill. If a formatter's notion of
 * "empty" changes, this predicate changes with it for free.
 */
import { eq } from 'drizzle-orm';
import { formatBusinessInfoPrompt, unwrapBusinessProfile } from '@jawab24/shared';
import { db } from '../db';
import { catalogItems } from '../db/schema';
import { formatBusinessProfile } from '../utils/businessProfile';
import { getStoreContextForAI } from './ecommerce';

/** The page fields this predicate reads. Structural, so tests need no DB row. */
export interface GroundablePage {
    id: string;
    knowledgeBase?: string | null;
    businessProfile?: unknown;
    ecommerceStoreId?: string | null;
}

/**
 * Which path grounds the reply. Diagnostic — surfaced in logs and asserted in
 * tests, never shown to a merchant (they get one actionable message, not a
 * taxonomy).
 */
export type GroundingSource =
    /** Merchant-authored Business Info text → `<business_knowledge>`. */
    | 'knowledge_base'
    /** Confirmed structured facts → the BUSINESS_INFO block (`merchant` half only). */
    | 'business_info_block'
    /** Descriptive fields (type/about/website) → the narrative block (merged half). */
    | 'profile_narrative'
    /** A live connected store's product/policy summary → every reply. */
    | 'store'
    /** Manually-entered catalog items. */
    | 'catalog';

/**
 * The first grounding source found, or null when the page has none.
 *
 * Ordered cheapest-first and short-circuiting on purpose: the three local checks
 * cover every page that has anything at all, so the two DB round-trips (store
 * context, catalog count) are only paid by a page that is about to be REFUSED —
 * never on the common path.
 */
export async function findGroundingSource(page: GroundablePage): Promise<GroundingSource | null> {
    if (page.knowledgeBase?.trim()) return 'knowledge_base';

    // Only the `merchant` half, provenance-gated — unconfirmed Facebook values
    // are omitted from the block, so they must not count as grounding here
    // either. `formatBusinessInfoPrompt` returns null for a profile that
    // contributes no line, which is precisely the question being asked.
    const { merchant, merchantProvenance } = unwrapBusinessProfile(
        page.businessProfile as Parameters<typeof unwrapBusinessProfile>[0],
    );
    if (formatBusinessInfoPrompt(merchant, merchantProvenance) !== null) return 'business_info_block';

    // The narrative path is a genuinely SEPARATE source, not a subset: it reads
    // the merged merchant ∪ suggestions half and emits business type / about /
    // website (D-010 keeps operational facts out of it). An FB page whose only
    // data is an unconfirmed Facebook "about" is grounded by this and by nothing
    // above it — omitting this check would refuse pages the model can answer for.
    if (formatBusinessProfile(page.businessProfile as Parameters<typeof formatBusinessProfile>[0]) !== null) {
        return 'profile_narrative';
    }

    // A store id alone is NOT proof — it survives a platform-side uninstall and
    // is set on a live store that synced nothing. `getStoreContextForAI` returns
    // `{}` unless the store is active AND actually has summary text, so asking it
    // is the same question the reply pipeline asks.
    if (page.ecommerceStoreId) {
        const storeContext = await getStoreContextForAI(page.ecommerceStoreId);
        if (storeContext.productCatalog || storeContext.storePolicies) return 'store';
    }

    const [row] = await db
        .select({ id: catalogItems.id })
        .from(catalogItems)
        .where(eq(catalogItems.pageId, page.id))
        .limit(1);
    if (row) return 'catalog';

    return null;
}

export interface BusinessInfoGateError {
    status: 409;
    body: {
        error: string;
        code: 'BUSINESS_INFO_REQUIRED';
    };
}

/**
 * The enable-time guard itself — the whole decision in one place, shaped like
 * `pageGateError` so the toggle handlers read the same way for every gate.
 *
 * Each of the three channel toggles used to inline "check the predicate, build
 * the 409", which is three chances to drift on the status, the message, or —
 * the subtle one — what a MISSING page means. Two handlers guarded with
 * `existingPage &&` and one did not, so the same absent row was treated
 * differently depending on the channel. That decision now lives here and is
 * made once.
 *
 * @param page the page being enabled, or null/undefined when the caller has not
 *   found one. A missing page is deliberately NOT this gate's problem: the
 *   handler's own 404 path owns it, and answering 409 here would tell a
 *   merchant to fix Business Info on a page that does not exist.
 * @returns null when auto-reply may be switched on; the refusal when it may not.
 *
 * 409 rather than 400/403: the request is well-formed and the caller is
 * entitled to it — it conflicts with the CURRENT STATE of the page, which the
 * merchant can resolve. That distinction is what lets the client route them to
 * Business Info instead of showing a dead-end error.
 */
export async function businessInfoGate(
    page: GroundablePage | null | undefined,
): Promise<BusinessInfoGateError | null> {
    if (!page) return null;
    if ((await findGroundingSource(page)) !== null) return null;

    return {
        status: 409,
        body: {
            error: 'Add your Business Info before switching auto-reply on — the AI has nothing to answer customers from.',
            code: 'BUSINESS_INFO_REQUIRED',
        },
    };
}
