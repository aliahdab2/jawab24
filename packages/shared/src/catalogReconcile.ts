/**
 * Catalog reconciliation (D-038) — classify each PROPOSED catalog row (from an
 * import, posts-scan, or post-reply scan) against the page's EXISTING catalog so
 * the review sheet can offer update-vs-add instead of blindly inserting.
 *
 * Without this, any recurring source that re-proposes an offering already in the
 * catalog creates a DUPLICATE row (two prices for one course → ambiguous replies).
 * With it, a re-proposed offering with a changed price surfaces as an UPDATE the
 * merchant confirms — never a silent override (D-038: confirmed data is authority,
 * sources only propose, the merchant decides, recency merely hints).
 *
 * Matching is deliberately cowardly: EXACT normalized-name equality, never token
 * subset. Course levels ("... - المستوى الأول" vs "... - المستوى الثاني") are
 * DISTINCT offerings and must stay distinct — a fuzzier match would wrongly merge
 * them and collapse a real price ladder into one row.
 *
 * Pure — no db/network — so both the backend (annotate scan/extract responses)
 * and the frontend (render the review sheet) run the identical classification.
 */

import { normalizeArabic } from './utils/arabic-normalize';

/** The existing catalog row a proposal is compared against (subset of catalog_items). */
export interface ReconcileExistingItem {
    id: string;
    name: string;
    /** numeric-as-string from the DB (e.g. "35000.00"), or null for price-on-request. */
    price: string | null;
    currency: string | null;
}

/** The minimum a proposal must expose to be reconciled (CatalogItemInput is a superset). */
export interface ReconcileProposalItem {
    name: string;
    /** number from the extractor, or null for price-on-request. */
    price: number | null;
    currency: string | null;
}

export type ReconcileKind =
    | 'new'        // no existing item shares this (normalized) name → insert
    | 'duplicate'  // an existing item matches name AND price+currency → nothing to do
    | 'update';    // an existing item matches name but price/currency differs → the conflict

export interface ReconcileResult<P extends ReconcileProposalItem = ReconcileProposalItem> {
    proposal: P;
    /** The existing item this proposal matched by name, or null when kind === 'new'. */
    match: ReconcileExistingItem | null;
    kind: ReconcileKind;
}

/** Normalized name key for equality: Arabic-normalized (taa-marbuta folded),
 *  lower-cased, whitespace-collapsed, trimmed. Empty → '' (never matches). */
function nameKey(name: string): string {
    return normalizeArabic(name ?? '', { normalizeTaaMarbuta: true })
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

/** Compare a proposal's numeric price to an existing row's string price. Both
 *  null (price-on-request) counts as equal; one null and one set is a change. */
function samePrice(existing: string | null, proposed: number | null): boolean {
    if (existing === null && proposed === null) return true;
    if (existing === null || proposed === null) return false;
    const e = Number(existing);
    return Number.isFinite(e) && e === proposed;
}

/** Currencies match when equal after trim/lowercase; both empty/null counts as equal. */
function sameCurrency(existing: string | null, proposed: string | null): boolean {
    const norm = (c: string | null) => (c ?? '').trim().toLowerCase();
    return norm(existing) === norm(proposed);
}

/**
 * Classify each proposal against the existing catalog.
 *
 * When several existing rows share one normalized name (a catalog that itself
 * carries duplicates), the FIRST is used as the match anchor — reconciliation
 * must never invent a second interpretation; cleaning pre-existing dupes is a
 * separate merchant action.
 */
export function reconcileCatalogProposals<P extends ReconcileProposalItem>(
    proposals: P[],
    existing: ReconcileExistingItem[],
): ReconcileResult<P>[] {
    const byName = new Map<string, ReconcileExistingItem>();
    for (const item of existing) {
        const key = nameKey(item.name);
        if (key && !byName.has(key)) byName.set(key, item);
    }

    return proposals.map((proposal) => {
        const key = nameKey(proposal.name);
        const match = key ? byName.get(key) ?? null : null;
        if (!match) return { proposal, match: null, kind: 'new' as const };
        const unchanged = samePrice(match.price, proposal.price) && sameCurrency(match.currency, proposal.currency);
        return { proposal, match, kind: unchanged ? ('duplicate' as const) : ('update' as const) };
    });
}
