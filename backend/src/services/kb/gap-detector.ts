import { db } from '../../db';
import { kbGaps, pages } from '../../db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { normalizeArabic } from '@jawab24/shared';
import { detectIntent, type PreGptIntent } from './intent-detector';
import { notificationService } from '../notifications';
import type { Logger } from '../../types/logger';
import { noopLogger } from '../../types/logger';

/** Number of occurrences before a notification is triggered */
const NOTIFICATION_THRESHOLD = 3;

/** Trigram similarity threshold for deduplicating similar gap queries */
const DEDUP_SIMILARITY = 0.5;

export interface GapRecord {
    id: string;
    pageId: string;
    queryText: string;
    queryNormalized: string;
    detectedIntent: PreGptIntent | null;
    occurrenceCount: number;
    firstSeenAt: Date | null;
    lastSeenAt: Date | null;
    resolved: boolean;
}

/**
 * KB Gap Detection Service
 *
 * Tracks queries that retrieval couldn't answer (no good chunks).
 * When a gap is seen repeatedly (>= NOTIFICATION_THRESHOLD), notifies the merchant.
 *
 * Deduplication: Uses pg_trgm similarity on normalized text + same intent to cluster
 * similar questions together rather than creating separate gap records.
 */
class GapDetectorService {
    private logger: Logger = noopLogger;

    setLogger(logger: Logger): void {
        this.logger = logger;
    }

    /**
     * Record a KB gap — called when retrieval returns no good chunks.
     *
     * 1. Normalize the query
     * 2. Detect intent
     * 3. Check for existing similar gap (trigram match + same intent)
     * 4. If found: increment occurrence count
     * 5. If new: insert new gap record
     * 6. If threshold reached: send notification to merchant
     */
    async recordGap(pageId: string, queryText: string): Promise<void> {
        try {
            const normalized = normalizeArabic(queryText).toLowerCase().trim();
            if (!normalized) return;

            const intent = detectIntent(queryText);

            // Try to find an existing similar gap (trigram dedup + intent match)
            const existing = await this.findSimilarGap(pageId, normalized, intent);

            if (existing) {
                // Atomic increment — avoids race condition where two concurrent
                // requests both read the same count and both trigger notification
                const updated = await db.execute(sql`
                    UPDATE kb_gaps
                    SET occurrence_count = COALESCE(occurrence_count, 0) + 1,
                        last_seen_at = NOW()
                    WHERE id = ${existing.id}::uuid
                    RETURNING occurrence_count
                `);

                const rows = updated as unknown as Array<Record<string, unknown>>;
                const newCount = Number(rows[0]?.occurrence_count ?? 0);

                this.logger.debug('Gap occurrence incremented', {
                    pageId, gapId: existing.id, newCount, intent,
                });

                // Check if we just crossed the notification threshold
                if (newCount === NOTIFICATION_THRESHOLD) {
                    await this.notifyMerchant(pageId, existing.queryText, intent, newCount);
                }
            } else {
                // Insert new gap record
                await db.insert(kbGaps).values({
                    pageId,
                    queryText,
                    queryNormalized: normalized,
                    detectedIntent: intent,
                });

                this.logger.debug('New KB gap recorded', { pageId, intent });
            }
        } catch (error) {
            // Gap detection is non-critical — never block the reply pipeline
            this.logger.error('Gap detection failed', {
                error: error instanceof Error ? error.message : String(error),
                pageId,
            });
        }
    }

    /**
     * Find an existing unresolved gap with similar normalized text and same intent.
     * Uses pg_trgm similarity for fuzzy matching.
     */
    private async findSimilarGap(
        pageId: string,
        normalizedQuery: string,
        intent: PreGptIntent,
    ): Promise<GapRecord | null> {
        const results = await db.execute(sql`
            SELECT
                id, page_id, query_text, query_normalized,
                detected_intent, occurrence_count,
                first_seen_at, last_seen_at, resolved
            FROM kb_gaps
            WHERE page_id = ${pageId}
              AND resolved = false
              AND detected_intent = ${intent}
              AND similarity(query_normalized, ${normalizedQuery}) >= ${DEDUP_SIMILARITY}
            ORDER BY similarity(query_normalized, ${normalizedQuery}) DESC
            LIMIT 1
        `);

        const rows = results as unknown as Array<Record<string, unknown>>;
        if (rows.length === 0) return null;

        const row = rows[0];
        return {
            id: row.id as string,
            pageId: row.page_id as string,
            queryText: row.query_text as string,
            queryNormalized: row.query_normalized as string,
            detectedIntent: (row.detected_intent as PreGptIntent) || null,
            occurrenceCount: Number(row.occurrence_count) || 0,
            firstSeenAt: row.first_seen_at ? new Date(row.first_seen_at as string) : null,
            lastSeenAt: row.last_seen_at ? new Date(row.last_seen_at as string) : null,
            resolved: Boolean(row.resolved),
        };
    }

    /**
     * Notify the merchant when a KB gap has been seen enough times.
     */
    private async notifyMerchant(
        pageId: string,
        sampleQuery: string,
        intent: PreGptIntent,
        occurrenceCount: number,
    ): Promise<void> {
        try {
            // Resolve userId from page
            const page = await db
                .select({ userId: pages.userId, name: pages.name })
                .from(pages)
                .where(eq(pages.id, pageId))
                .limit(1);

            if (!page[0]?.userId) {
                this.logger.error('Gap notification: page has no userId', { pageId });
                return;
            }

            const userId = page[0].userId;
            const pageName = page[0].name || 'your page';

            // Truncate query for notification display
            const shortQuery = sampleQuery.length > 80
                ? sampleQuery.substring(0, 77) + '...'
                : sampleQuery;

            await notificationService.sendTemplateNotification(
                userId,
                'kb_gap',
                { pageName, topic: shortQuery },
                { pageId, intent, occurrenceCount, sampleQuery },
            );

            this.logger.info('Gap notification sent to merchant', {
                userId, pageId, intent, occurrenceCount,
            });
        } catch (error) {
            this.logger.error('Failed to send gap notification', {
                error: error instanceof Error ? error.message : String(error),
                pageId,
            });
        }
    }

    /**
     * Mark a gap as resolved (e.g., when the merchant updates their KB).
     */
    async resolveGap(gapId: string): Promise<void> {
        await db
            .update(kbGaps)
            .set({ resolved: true })
            .where(eq(kbGaps.id, gapId));
    }

    /**
     * Mark all gaps for a page as resolved (e.g., after KB re-ingestion).
     */
    async resolveAllForPage(pageId: string): Promise<void> {
        await db
            .update(kbGaps)
            .set({ resolved: true })
            .where(and(
                eq(kbGaps.pageId, pageId),
                eq(kbGaps.resolved, false),
            ));
    }

    /**
     * Get unresolved gaps for a page, ordered by occurrence count.
     */
    async getUnresolvedGaps(pageId: string, limit: number = 20): Promise<GapRecord[]> {
        const results = await db
            .select()
            .from(kbGaps)
            .where(and(
                eq(kbGaps.pageId, pageId),
                eq(kbGaps.resolved, false),
            ))
            .orderBy(sql`occurrence_count DESC`)
            .limit(limit);

        return results.map(row => ({
            id: row.id,
            pageId: row.pageId,
            queryText: row.queryText,
            queryNormalized: row.queryNormalized,
            detectedIntent: (row.detectedIntent as PreGptIntent) || null,
            occurrenceCount: row.occurrenceCount || 0,
            firstSeenAt: row.firstSeenAt,
            lastSeenAt: row.lastSeenAt,
            resolved: row.resolved ?? false,
        }));
    }
}

export const gapDetectorService = new GapDetectorService();
