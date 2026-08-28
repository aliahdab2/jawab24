/**
 * Store-facts sync (D-102): apply facts synced from a connected e-commerce
 * store (Salla/Zid store settings — phones, WhatsApp, hours, website) to the
 * `business_profile` of every page linked to that store, as provenance
 * source `store_sync`.
 *
 * ORDERING CONTRACT (D-102): callers run this inside the platform `fullSync`
 * BEFORE `syncProducts`, so the sync's existing tail
 * (`replaceProductsAndRebuildSummary` → `invalidateCachesForStore`) performs
 * the semantic-cache purge + RAG re-ingest + atomic version flip (both
 * kbActiveVersion and kbIndexedVersion — D-106) for the same linked
 * pages. This function itself writes `business_profile` +
 * `business_profile_updated_at` ONLY — no version bumps (see the
 * kb_extract writer in pages.ts for why bumping here would orphan chunks).
 * Store-linked pages bypass the exact/semantic reply caches anyway
 * (dispatchAiReply → generateReplyWithTools), so live replies read the
 * fresh profile immediately.
 *
 * Never throws: a facts failure must never abort the product sync — each
 * page is caught, reported, and skipped.
 */
import { eq } from 'drizzle-orm';
import {
    applyStoreSyncToMerchant,
    hasTrackedField,
    unwrapBusinessProfile,
    type BusinessProfile,
    type BusinessProfileContainer,
    type StoredBusinessProfile,
} from '@jawab24/shared';
import { db } from '../db';
import { pages } from '../db/schema';
import { captureError } from '../utils/sentryHelpers';
import type { Logger } from '../types';
import { noopLogger } from '../types';

/**
 * Report a store-facts field whose shape we could not read. The drop itself
 * is correct handling (a cosmetic field must not abort a sync), but a SILENT
 * drop is how the next payload drift stays invisible — same doctrine as the
 * Zid profile-field drops. Only the value's TYPE ships to Sentry, never the
 * value: these fields carry merchant contact data.
 */
export function reportStoreFactDrop(platform: string, field: string, input: unknown): void {
    captureError(
        new Error(`Store fact '${field}' (${platform}) has an unreadable shape — dropped`),
        'Store fact field drop',
        {
            level: 'warning',
            fingerprint: ['store-facts-field-drop', platform, field],
            tags: { service: platform, action: 'store-facts-sync' },
            extra: { field, receivedType: Array.isArray(input) ? 'array' : typeof input },
        },
    );
}

/**
 * Apply a store's synced facts to every page linked to it
 * (`pages.ecommerce_store_id` — the same population `invalidateCachesForStore`
 * re-ingests, so the D-102 ordering contract covers exactly these pages).
 * Non-store pages are structurally unreachable from here.
 */
export async function applyStoreFactsToLinkedPages(
    storeId: string,
    facts: BusinessProfile,
    logger: Logger = noopLogger,
): Promise<{ pagesUpdated: number }> {
    if (!hasTrackedField(facts)) return { pagesUpdated: 0 };

    let linkedPages: Array<{ id: string; businessProfile: unknown }>;
    try {
        linkedPages = await db
            .select({ id: pages.id, businessProfile: pages.businessProfile })
            .from(pages)
            .where(eq(pages.ecommerceStoreId, storeId));
    } catch (err) {
        captureError(err, 'Store-facts sync: linked-pages lookup failed', {
            tags: { service: 'ecommerce', action: 'store-facts-sync' },
            extra: { storeId },
        });
        return { pagesUpdated: 0 };
    }

    let pagesUpdated = 0;
    for (const page of linkedPages) {
        try {
            const existing = unwrapBusinessProfile(page.businessProfile as StoredBusinessProfile);
            const { merchant, merchantProvenance } = applyStoreSyncToMerchant(
                existing.merchant,
                existing.merchantProvenance,
                facts,
            );

            // No-op is the common case (editor/kb_extract own the fields, or
            // the re-sync matches the stored store_sync values).
            const changed = JSON.stringify(merchant) !== JSON.stringify(existing.merchant ?? {});
            if (!changed) continue;

            const container: BusinessProfileContainer = {
                merchant,
                ...(existing.suggestions ? { suggestions: existing.suggestions } : {}),
                merchantProvenance,
            };
            await db
                .update(pages)
                .set({
                    businessProfile: container,
                    businessProfileUpdatedAt: new Date(),
                })
                .where(eq(pages.id, page.id));
            pagesUpdated += 1;
            logger.info('Store-facts sync: refreshed merchant facts from store', {
                pageId: page.id, storeId, fields: Object.keys(facts),
            });
        } catch (err) {
            captureError(err, 'Store-facts sync: page update failed', {
                tags: { service: 'ecommerce', action: 'store-facts-sync' },
                extra: { storeId, pageId: page.id },
            });
        }
    }
    return { pagesUpdated };
}
