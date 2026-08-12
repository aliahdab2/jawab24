import type { PostSuggestionVariantRow } from '../db/schema';

/**
 * Pure readers over a `post_suggestions` row's takes.
 *
 * They live HERE, not in the service, for two reasons. Rule 10.9 — a helper
 * two modules share belongs in its own file — and a concrete import cycle:
 * page deletion needs the storage footprint, so `services/pages.ts` would have
 * to import `services/postSuggestions.ts`, which reaches `services/catalog.ts`
 * and `services/factCollections.ts`, both of which import `services/pages.ts`
 * back. A hoisted function declaration happens to survive that cycle; a module
 * with no service imports at all makes it impossible (Rule 14: prevention over
 * detection).
 */

/**
 * A row's takes, ALWAYS as a non-empty list.
 *
 * Rows written before variants shipped carry `variants = null`; they project to
 * the single take their columns already describe. One home for that projection
 * so no caller has to branch on the null — the class of bug where the dashboard
 * handles legacy rows and the sheet does not.
 */
export function variantsOf(row: {
    text: string;
    imageUrl: string | null;
    imageKey?: string | null;
    variants: PostSuggestionVariantRow[] | null;
}): PostSuggestionVariantRow[] {
    if (row.variants?.length) return row.variants;
    return [{ text: row.text, headline: null, imageUrl: row.imageUrl, imageKey: row.imageKey ?? null }];
}

/**
 * Every storage handle a row owns — the mirrored column AND each take's file.
 * Deduplicated, because the selected take's key is deliberately mirrored into
 * `image_key` and a double-delete would log a spurious storage error.
 */
export function imageKeysOf(row: {
    imageKey?: string | null;
    variants: PostSuggestionVariantRow[] | null;
}): string[] {
    const keys = new Set<string>();
    if (row.imageKey) keys.add(row.imageKey);
    for (const variant of row.variants ?? []) {
        if (variant.imageKey) keys.add(variant.imageKey);
    }
    return [...keys];
}
