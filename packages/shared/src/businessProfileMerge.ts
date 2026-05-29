import type { BusinessProfile, BusinessProfileContainer, StoredBusinessProfile } from './index';
import { unwrapBusinessProfile } from './index';

export type ProvenanceSource = 'fb_sync' | 'editor';

export interface FieldProvenance {
    /**
     * Where this field's current value originated:
     *   - 'fb_sync' — auto-promoted from the FB-sync `suggestions` half on
     *     a previous sync. May be refreshed by future syncs.
     *   - 'editor'  — merchant typed or cleared this field via the editor.
     *     Future FB syncs MUST NOT overwrite.
     */
    source: ProvenanceSource;
    /**
     * ISO 8601 timestamp of when the merchant last confirmed this field
     * via the editor. `null` means the merchant has never touched it
     * (i.e. fb_sync values that are still awaiting review).
     */
    confirmedAt: string | null;
}

/**
 * Sidecar map of per-field provenance for the `merchant` half of the
 * `business_profile` container. Keys mirror BusinessProfile field names.
 *
 * Semantics of the three observable states:
 *   - `provenance[F]` ABSENT          → field has never been seen on
 *                                       either side (FB never returned it
 *                                       AND merchant never typed it).
 *   - `provenance[F].source = 'fb_sync', confirmedAt: null`
 *                                     → FB-promoted; merchant hasn't
 *                                       reviewed; future sync may refresh.
 *   - `provenance[F].source = 'editor'`
 *                                     → merchant edited or cleared this
 *                                       field; future sync skips it. When
 *                                       `merchant[F]` is absent AND
 *                                       provenance is editor, the merchant
 *                                       explicitly CLEARED the field
 *                                       (the "cleared ≠ never-seen"
 *                                       distinction Stage 2.6.1 closes).
 */
export type MerchantProvenanceMap = Partial<Record<keyof BusinessProfile, FieldProvenance>>;

/**
 * Fields tracked by Option B provenance. `phone` (singular, deprecated)
 * is excluded because it's coerced into `phones[0]` by FB sync and would
 * otherwise produce a redundant provenance entry.
 *
 * Exported so the one-shot migration scripts can iterate the same set
 * without redefining the constant (avoids drift if a new field is added).
 */
export const TRACKED_FIELDS: ReadonlyArray<keyof BusinessProfile> = [
    'name', 'category', 'about', 'phones', 'website',
    'address', 'city', 'country', 'hours', 'channels',
    'language_hint', 'policies',
];

/** True if the BusinessProfile has at least one tracked field set. */
export function hasTrackedField(profile: BusinessProfile | undefined): boolean {
    if (!profile) return false;
    return TRACKED_FIELDS.some(f => profile[f] !== undefined);
}

/**
 * Defensive normalization for the Option B rollout window. A row written
 * BEFORE the migration may have `merchant` populated (via the editor) but
 * no `merchantProvenance` at all. Without this, the next FB sync would see
 * "no provenance" for every field and clobber the merchant's manual edits.
 *
 * The migration sets this state explicitly; this is the fallback for
 * any sync that races the migration.
 */
function normalizeLegacyProvenance(
    merchant: BusinessProfile,
    provenance: MerchantProvenanceMap,
): MerchantProvenanceMap {
    const out: MerchantProvenanceMap = { ...provenance };
    for (const field of TRACKED_FIELDS) {
        if (merchant[field] !== undefined && !out[field]) {
            // Pre-Option-B merchant values can only have come from the
            // editor (the gate prevented FB suggestions from landing in
            // merchant). Treat them as editor-owned to preserve them.
            out[field] = { source: 'editor', confirmedAt: null };
        }
    }
    return out;
}

/**
 * Apply Facebook sync suggestions into the `merchant` half with per-field
 * provenance tracking. Pure function — does not mutate inputs.
 *
 * Per-field decision (in order):
 *   1. FB sync provided no value for this field           → leave alone.
 *   2. provenance says editor-owned (set or cleared)      → leave alone.
 *   3. Otherwise (never seen OR previously fb_sync)       → populate from
 *      FB, set provenance to {source: 'fb_sync', confirmedAt: null}.
 *
 * Note rule 2 covers BOTH "merchant typed a value" and "merchant cleared
 * the field" via the same condition (`source === 'editor'`) — the
 * distinction lives in whether `merchant[F]` has a value or not. This is
 * the "cleared ≠ never-seen" guarantee.
 *
 * This function does NOT remove fields that FB no longer reports. If a
 * field was previously fb_sync and FB now omits it, the old value
 * persists in `merchant`. Tradeoff: tolerates transient FB API gaps at
 * the cost of letting truly-stale fb_sync values linger. The dashboard
 * "review & confirm" UI is the merchant's escape hatch.
 */
export function applyFbSyncToMerchant(
    existingMerchant: BusinessProfile | undefined,
    existingProvenance: MerchantProvenanceMap | undefined,
    fbSuggestions: BusinessProfile,
): { merchant: BusinessProfile; merchantProvenance: MerchantProvenanceMap } {
    const startingMerchant: BusinessProfile = { ...(existingMerchant ?? {}) };
    const provenance = normalizeLegacyProvenance(
        startingMerchant,
        { ...(existingProvenance ?? {}) },
    );
    const merchant = startingMerchant;

    for (const field of TRACKED_FIELDS) {
        const fbValue = fbSuggestions[field];
        // Rule 1: FB has nothing for this field.
        if (fbValue === undefined) continue;

        // Rule 2: editor-owned (set or cleared). Skip.
        if (provenance[field]?.source === 'editor') continue;

        // Rule 3: never seen OR previously fb_sync. Populate/refresh.
        (merchant as Record<string, unknown>)[field] = fbValue;
        provenance[field] = { source: 'fb_sync', confirmedAt: null };
    }

    return { merchant, merchantProvenance: provenance };
}

/**
 * Apply a merchant editor save (full-replace PATCH semantics). The PATCH
 * represents the merchant's full intent for the `merchant` half; every
 * tracked field that has ever been seen becomes editor-owned after the
 * save. Pure function.
 *
 * Semantics:
 *   - Field present in PATCH         → editor-set, confirmedAt = now
 *   - Field absent from PATCH but present in existing provenance
 *                                    → editor-cleared, confirmedAt = now
 *                                      (the "cleared" tombstone — Rule 2
 *                                      in applyFbSyncToMerchant will see
 *                                      source='editor' and skip)
 *   - Field absent from both         → still never-seen, no provenance entry
 *
 * `confirmedAt` is bumped on EVERY save, including for fields the merchant
 * didn't actively change. Rationale: a save action means "I reviewed this
 * and it's correct" — saving IS confirming. The dashboard "review &
 * confirm" UI consumes confirmedAt as the source-of-truth for which
 * fb_sync fields still need merchant attention.
 */
export function applyMerchantEdit(
    patch: BusinessProfile,
    existingProvenance: MerchantProvenanceMap | undefined,
    now: Date = new Date(),
): { merchant: BusinessProfile; merchantProvenance: MerchantProvenanceMap } {
    const provenance: MerchantProvenanceMap = { ...(existingProvenance ?? {}) };
    const nowIso = now.toISOString();

    for (const field of TRACKED_FIELDS) {
        if (patch[field] !== undefined) {
            // Field present in PATCH → merchant set/confirmed.
            provenance[field] = { source: 'editor', confirmedAt: nowIso };
        } else if (provenance[field]) {
            // Field absent from PATCH but provenance has a record → merchant cleared.
            // Bump confirmedAt so the cleared state has a fresh "merchant
            // intentionally chose this" timestamp.
            provenance[field] = { source: 'editor', confirmedAt: nowIso };
        }
        // else: never-seen + still-not-set → leave absent from provenance.
    }

    return { merchant: { ...patch }, merchantProvenance: provenance };
}

/**
 * One-shot migration plan for a single stored `business_profile` row.
 * Single source of truth shared by the apply script
 * (`scripts/promote-business-profile-fb-sync.ts`) and the read-only
 * analyzer (`scripts/analyze-prod-promotion.ts`).
 *
 * Returns a discriminated union describing what the migration should do
 * with this row. Callers handle their own I/O — write the new container,
 * print a dry-run line, count aggregates, etc.
 */
export type MigrationPlan =
    | { kind: 'skip'; reason: 'already_migrated' | 'no_data' | 'anomaly'; details?: string }
    | { kind: 'promote_fb_sync'; newContainer: BusinessProfileContainer; promotedFields: string[] }
    | { kind: 'wrap_legacy'; newContainer: BusinessProfileContainer; promotedFields: string[] }
    | { kind: 'backfill_editor'; newContainer: BusinessProfileContainer; backfilledFields: string[] };

/**
 * Classify a stored `business_profile` row and compute the one-shot
 * Stage 2.6.1 (Option B) migration plan for it. Pure function — no I/O.
 *
 * Three actionable shapes, plus skips:
 *   - container, merchant={}, suggestions populated  → promote_fb_sync
 *   - legacy flat with at least one tracked field    → wrap_legacy
 *   - container, merchant populated                  → backfill_editor
 *                                                      (existing merchant
 *                                                      data could only be
 *                                                      editor writes pre-
 *                                                      Option-B; record
 *                                                      that in provenance)
 *   - container already has merchantProvenance       → skip (idempotent)
 *   - genuinely empty (no signal data on either half)→ skip
 *
 * The "is container shape" detection re-parses the raw input so it can
 * distinguish a legacy flat row from a container with empty merchant —
 * `unwrapBusinessProfile` deliberately collapses both into the same
 * post-unwrap shape, which is right for the prompt formatter but wrong
 * for migration classification.
 */
export function classifyForMigration(stored: StoredBusinessProfile): MigrationPlan {
    const container = unwrapBusinessProfile(stored);

    if (container.merchantProvenance) {
        return { kind: 'skip', reason: 'already_migrated' };
    }

    // Determine shape from the raw input. unwrapBusinessProfile's output
    // demotes legacy-flat into suggestions, which loses the distinction
    // we need here.
    const parsedRaw: unknown = (() => {
        if (stored == null) return null;
        if (typeof stored === 'string') {
            try { return JSON.parse(stored); } catch { return null; }
        }
        return stored;
    })();
    const isContainerShape = !!parsedRaw && typeof parsedRaw === 'object'
        && ('merchant' in (parsedRaw as object) || 'suggestions' in (parsedRaw as object));

    const merchant = container.merchant ?? {};
    const suggestions = container.suggestions ?? {};
    const merchantHas = hasTrackedField(merchant);
    const suggestionsHas = hasTrackedField(suggestions);

    // Case A: legacy flat with at least one signal/tracked field.
    if (!isContainerShape && suggestionsHas) {
        const promoted = applyFbSyncToMerchant(undefined, undefined, suggestions);
        return {
            kind: 'wrap_legacy',
            newContainer: {
                merchant: promoted.merchant,
                suggestions,
                merchantProvenance: promoted.merchantProvenance,
            },
            promotedFields: Object.keys(promoted.merchantProvenance),
        };
    }

    // Case B: container with merchant={} and suggestions populated.
    if (isContainerShape && !merchantHas && suggestionsHas) {
        const promoted = applyFbSyncToMerchant(undefined, undefined, suggestions);
        return {
            kind: 'promote_fb_sync',
            newContainer: {
                merchant: promoted.merchant,
                suggestions,
                merchantProvenance: promoted.merchantProvenance,
            },
            promotedFields: Object.keys(promoted.merchantProvenance),
        };
    }

    // Case C: container with merchant already populated. Backfill provenance
    // as 'editor' (pre-Option-B merchant data could only have come from the
    // editor — the gate blocked FB suggestions from reaching merchant).
    if (isContainerShape && merchantHas) {
        const provenance: MerchantProvenanceMap = {};
        const backfilled: string[] = [];
        for (const f of TRACKED_FIELDS) {
            if (merchant[f] !== undefined) {
                provenance[f] = { source: 'editor', confirmedAt: null };
                backfilled.push(f);
            }
        }
        return {
            kind: 'backfill_editor',
            newContainer: { merchant, suggestions, merchantProvenance: provenance },
            backfilledFields: backfilled,
        };
    }

    // Fall-through: empty container, legacy flat with no signal, or anomaly.
    const isEmpty = !merchantHas && !suggestionsHas;
    return isEmpty
        ? { kind: 'skip', reason: 'no_data' }
        : { kind: 'skip', reason: 'anomaly', details: `isContainerShape=${isContainerShape} merchantHas=${merchantHas} suggestionsHas=${suggestionsHas}` };
}
