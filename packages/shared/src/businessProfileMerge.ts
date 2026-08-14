import type { BusinessProfile, BusinessProfileContainer, StoredBusinessProfile } from './index';
import { unwrapBusinessProfile } from './index';

export type ProvenanceSource = 'fb_sync' | 'editor' | 'kb_extract';

export interface FieldProvenance {
    /**
     * Where this field's current value originated:
     *   - 'fb_sync'    — auto-promoted from the FB-sync `suggestions` half on
     *     a previous sync. May be refreshed by future syncs.
     *   - 'editor'     — merchant typed or cleared this field via the editor.
     *     Future FB syncs / KB extractions MUST NOT overwrite.
     *   - 'kb_extract' — auto-extracted from the merchant's free-text KB
     *     (operationalFactsExtractor). Lowest authority: a later FB sync or a
     *     merchant edit overrides it; a re-extraction may refresh it.
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
    'name', 'category', 'about', 'phones', 'email', 'website',
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

        // Rule 2: merchant-authored values are never overwritten by Facebook —
        // editor-owned (set or cleared) OR extracted from the merchant's own KB
        // (kb_extract). Decision D-008: editor > kb_extract > fb_sync, "Facebook
        // never overrides." Skipping kb_extract keeps the KB-derived operational
        // facts (hours/phone/address) the block asserts from being clobbered back
        // to stale FB values on the next sync.
        const src = provenance[field]?.source;
        if (src === 'editor' || src === 'kb_extract') continue;

        // Rule 3: never seen OR previously fb_sync. Populate/refresh.
        (merchant as Record<string, unknown>)[field] = fbValue;
        provenance[field] = { source: 'fb_sync', confirmedAt: null };
    }

    return { merchant, merchantProvenance: provenance };
}

/**
 * Order-insensitive deep equality for BusinessProfile field values (strings,
 * arrays like `phones`, nested objects like `hours`/`policies`/`channels`).
 * Array ORDER is significant (phones are "in the merchant's order"); object
 * key order is not — the hours sheet may rebuild an identical week with a
 * different key sequence, and that must not read as an edit.
 */
function valueEquals(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a == null || b == null) return a === b;
    if (Array.isArray(a) || Array.isArray(b)) {
        if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
        return a.every((v, i) => valueEquals(v, b[i]));
    }
    if (typeof a === 'object' && typeof b === 'object') {
        const ak = Object.keys(a as object).filter(k => (a as Record<string, unknown>)[k] !== undefined).sort();
        const bk = Object.keys(b as object).filter(k => (b as Record<string, unknown>)[k] !== undefined).sort();
        if (ak.length !== bk.length || ak.some((k, i) => k !== bk[i])) return false;
        return ak.every(k => valueEquals((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
    }
    return false;
}

/**
 * Apply a merchant editor save (full-replace PATCH semantics). The PATCH
 * represents the merchant's full intent for the `merchant` half. Pure function.
 *
 * Semantics (per tracked field):
 *   - Present in PATCH with a DIFFERENT value than `existingMerchant`
 *                                    → editor-set, confirmedAt = now
 *   - Present in PATCH, value UNCHANGED, field listed in `confirmFields`
 *                                    → editor-confirmed, confirmedAt = now
 *                                      (the merchant explicitly reviewed it —
 *                                      e.g. opened that field's sheet and saved)
 *   - Present in PATCH, value UNCHANGED, NOT in `confirmFields`
 *                                    → existing provenance carried forward
 *                                      UNTOUCHED (no entry stays no entry)
 *   - Absent from PATCH but `existingMerchant` had a value
 *                                    → editor-cleared, confirmedAt = now
 *                                      (the "cleared" tombstone — Rule 2
 *                                      in applyFbSyncToMerchant will see
 *                                      source='editor' and skip)
 *   - Absent from both               → existing provenance carried forward
 *                                      (a prior tombstone stays; never-seen
 *                                      stays absent)
 *
 * WHY the unchanged-value rule exists (2026-08-08, MES «+971556087128»): the
 * /business editor must echo the WHOLE merchant half on every single-field
 * save (full-replace semantics — a partial patch would tombstone the other
 * fields). The previous "saving IS confirming" rule stamped every echoed
 * field editor+confirmedAt, which LAUNDERED unconfirmed fb_sync values into
 * merchant-confirmed data: one unrelated fact edit promoted a stale
 * Facebook-synced UAE phone past the businessInfoPrompt authority gate and
 * into customer replies. Saving is confirming ONLY for what the merchant
 * actually changed or explicitly reviewed — never for fields that merely
 * rode along in the echo.
 *
 * `existingMerchant === undefined` (legacy caller that cannot supply the
 * stored half) degrades safely: every present field counts as changed, i.e.
 * the pre-fix behavior.
 */
export function applyMerchantEdit(
    patch: BusinessProfile,
    existingProvenance: MerchantProvenanceMap | undefined,
    now: Date = new Date(),
    existingMerchant?: BusinessProfile,
    confirmFields?: ReadonlyArray<keyof BusinessProfile>,
): { merchant: BusinessProfile; merchantProvenance: MerchantProvenanceMap } {
    const provenance: MerchantProvenanceMap = { ...(existingProvenance ?? {}) };
    const nowIso = now.toISOString();

    for (const field of TRACKED_FIELDS) {
        if (patch[field] !== undefined) {
            const unchanged = existingMerchant !== undefined
                && valueEquals(patch[field], existingMerchant[field]);
            if (!unchanged || confirmFields?.includes(field)) {
                provenance[field] = { source: 'editor', confirmedAt: nowIso };
            }
            // Unchanged and not explicitly confirmed → the field only rode
            // along in the full-replace echo; its provenance stays as-is.
        } else if (existingMerchant?.[field] !== undefined
            || (existingMerchant === undefined && provenance[field])) {
            // A value existed and the PATCH dropped it → merchant cleared.
            // (Legacy no-existingMerchant callers keep the old rule: any
            // provenance record + absent field reads as a clear.)
            provenance[field] = { source: 'editor', confirmedAt: nowIso };
        }
        // else: never-seen + still-not-set, or an existing tombstone the
        // PATCH still omits → leave provenance as it stands.
    }

    return { merchant: { ...patch }, merchantProvenance: provenance };
}

/**
 * Apply facts auto-extracted from the merchant's free-text KB
 * (operationalFactsExtractor) into the `merchant` half. Pure function —
 * does not mutate inputs.
 *
 * The KB is the merchant's source of truth for operational facts, so a value
 * extracted from it outranks an unconfirmed Facebook value (decision D-008:
 * editor > kb_extract > fb_sync — "Facebook never overrides"). Only a value
 * the merchant CONFIRMED in the editor outranks a KB extraction. Per-field
 * decision (in order):
 *   1. Extractor produced no value for this field            → leave alone.
 *   2. provenance is a CONFIRMED editor edit (source 'editor'
 *      AND confirmedAt set)                                  → leave alone
 *      (a real merchant edit beats a KB-prose extraction).
 *   3. Otherwise — never-seen, previously 'kb_extract', 'fb_sync', OR an
 *      UNCONFIRMED 'editor' entry (confirmedAt: null) → populate/refresh,
 *      set provenance {source: 'kb_extract', confirmedAt: null}.
 *
 * Why unconfirmed editor (confirmedAt: null) is overwritable: a real save
 * always stamps confirmedAt (applyMerchantEdit, "saving IS confirming"), so
 * that state is only ever produced by normalizeLegacyProvenance — which on
 * FB-synced-into-flat pages wrongly labels Facebook data as 'editor' (prod
 * page 39aeab89: merchant === suggestions, Friday "00:00-23:45"). The gate
 * (businessInfoPrompt) already treats such entries as non-authoritative; this
 * keeps the write path consistent, so the merchant's KB hours replace the
 * mislabeled FB values instead of being permanently shadowed by them. A
 * field the merchant only ever typed pre-Option-B and never put in their KB
 * is still preserved (rule 1: nothing extracted → nothing overwritten).
 */
export function applyKbExtractToMerchant(
    existingMerchant: BusinessProfile | undefined,
    existingProvenance: MerchantProvenanceMap | undefined,
    extracted: BusinessProfile,
): { merchant: BusinessProfile; merchantProvenance: MerchantProvenanceMap } {
    const startingMerchant: BusinessProfile = { ...(existingMerchant ?? {}) };
    const provenance = normalizeLegacyProvenance(
        startingMerchant,
        { ...(existingProvenance ?? {}) },
    );
    const merchant = startingMerchant;

    for (const field of TRACKED_FIELDS) {
        const value = extracted[field];
        // Rule 1: extractor has nothing for this field.
        if (value === undefined) continue;

        // Rule 2: only a CONFIRMED merchant edit outranks a KB extraction.
        // Unconfirmed 'editor' (confirmedAt: null) is never a real save — it is
        // the normalizeLegacyProvenance auto-stamp (which mislabels FB-synced-
        // into-flat data as editor), so it is overwritable. fb_sync is also
        // overwritable: the KB is the source of truth for operational facts
        // (D-008: editor > kb_extract > fb_sync).
        const entry = provenance[field];
        if (entry?.source === 'editor' && entry.confirmedAt != null) continue;

        // Rule 3: never-seen, previously kb_extract/fb_sync, or unconfirmed
        // editor → populate/refresh from the KB.
        (merchant as Record<string, unknown>)[field] = value;
        provenance[field] = { source: 'kb_extract', confirmedAt: null };
    }

    return { merchant, merchantProvenance: provenance };
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
