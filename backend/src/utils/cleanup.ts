/**
 * Database Cleanup Tasks
 * Run these periodically to maintain database health
 */

import { db } from '../db';
import { aiCache, logs, usageLogs, refreshTokens, otpCodes, semanticCache, ecommerceStores, customerNotificationsLog, emailSends, messages } from '../db/schema';
import { lt, eq, and, ne, sql, SQL } from 'drizzle-orm';
import type { PgTable, PgColumn } from 'drizzle-orm/pg-core';
import { Logger, noopLogger, CleanupResult } from '../types';
import { SEMANTIC_CACHE_TTL_DAYS } from '../services/kb/semantic-cache';
import { invalidateEndpointStatsCaches } from '../services/statsCache';

/**
 * Delete rows matching a condition in batches to avoid long-running transactions.
 * Returns total rows deleted.
 */
async function batchDelete(
    tableName: string,
    table: PgTable,
    idCol: PgColumn,
    condition: SQL,
    batchSize: number,
): Promise<CleanupResult> {
    let totalDeleted = 0;
    try {
        let deletedInBatch: number;
        do {
            const result = await db
                .delete(table)
                .where(condition)
                .returning({ id: idCol });
            deletedInBatch = result.length;
            totalDeleted += deletedInBatch;
        } while (deletedInBatch >= batchSize);
        return { table: tableName, deletedCount: totalDeleted };
    } catch (error) {
        return {
            table: tableName,
            deletedCount: totalDeleted,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

function daysAgo(n: number): Date {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d;
}

export async function cleanupAiCache(daysOld: number = 30, batchSize: number = 1000): Promise<CleanupResult> {
    return batchDelete('ai_cache', aiCache, aiCache.id, lt(aiCache.lastUsedAt, daysAgo(daysOld)), batchSize);
}

export async function cleanupLogs(daysOld: number = 90, batchSize: number = 1000): Promise<CleanupResult> {
    return batchDelete('logs', logs, logs.id, lt(logs.createdAt, daysAgo(daysOld)), batchSize);
}

export async function cleanupUsageLogs(daysOld: number = 180, batchSize: number = 1000): Promise<CleanupResult> {
    return batchDelete('usage_logs', usageLogs, usageLogs.id, lt(usageLogs.createdAt, daysAgo(daysOld)), batchSize);
}

/**
 * Clean up expired or revoked refresh tokens
 * Removes tokens that are expired or were revoked more than 7 days ago
 */
export async function cleanupRefreshTokens(): Promise<CleanupResult> {
    // Two passes: expired tokens + revoked tokens older than 7 days
    const [expired, revoked] = await Promise.all([
        batchDelete('refresh_tokens', refreshTokens, refreshTokens.id, lt(refreshTokens.expiresAt, new Date()), 1000),
        batchDelete('refresh_tokens', refreshTokens, refreshTokens.id, lt(refreshTokens.revokedAt, daysAgo(7)), 1000),
    ]);
    const error = expired.error || revoked.error;
    return {
        table: 'refresh_tokens',
        deletedCount: expired.deletedCount + revoked.deletedCount,
        ...(error ? { error } : {}),
    };
}

/**
 * Clean up stale semantic cache entries using two criteria:
 *
 * 1. Version-outdated: entries whose kb_active_version_at_creation no longer matches
 *    the page's current kbActiveVersion. These will never be served again — the query
 *    in semantic-cache.ts filters them out. Cleaning them promptly frees space after
 *    every KB update without waiting for age-based expiry.
 *
 * 2. Age-expired: entries older than SEMANTIC_CACHE_TTL_DAYS, matching the TTL
 *    enforced at query time. Catches orphaned entries for deleted pages or other
 *    edge cases.
 */
export async function cleanupSemanticCache(batchSize: number = 1000): Promise<CleanupResult> {
    let totalDeleted = 0;

    try {
        // 1. Version-outdated entries: join pages to find entries whose version is stale.
        //    Uses a subquery to identify IDs in batches, avoiding a full-table scan.
        let deletedInBatch: number;
        do {
            const result = await db.execute(sql`
                DELETE FROM semantic_cache
                WHERE id IN (
                    SELECT sc.id FROM semantic_cache sc
                    JOIN pages p ON p.id = sc.page_id
                    WHERE sc.kb_active_version_at_creation != p.kb_active_version
                    LIMIT ${batchSize}
                )
                RETURNING id
            `);
            deletedInBatch = (result as unknown[]).length;
            totalDeleted += deletedInBatch;
        } while (deletedInBatch >= batchSize);

        // 2. Age-expired entries: catch orphans for deleted pages or other edge cases.
        const aged = await batchDelete(
            'semantic_cache', semanticCache, semanticCache.id,
            lt(semanticCache.createdAt, daysAgo(SEMANTIC_CACHE_TTL_DAYS)), batchSize,
        );
        totalDeleted += aged.deletedCount;
        if (aged.error) throw new Error(aged.error);

        return { table: 'semantic_cache', deletedCount: totalDeleted };
    } catch (error) {
        return {
            table: 'semantic_cache',
            deletedCount: totalDeleted,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

export async function cleanupOtpCodes(): Promise<CleanupResult> {
    return batchDelete('otp_codes', otpCodes, otpCodes.id, lt(otpCodes.expiresAt, new Date()), 1000);
}

/** Days an uninstalled/disconnected store is retained before GDPR erasure. */
export const INACTIVE_STORE_RETENTION_DAYS = 30;

/**
 * GDPR data-minimisation: hard-delete e-commerce stores that have been inactive
 * (uninstalled or disconnected) for longer than the retention window.
 *
 * Deleting the `ecommerce_stores` row drops its encrypted access/refresh tokens
 * and FK-cascades to `ecommerce_products`, `customer_notification_templates` and
 * `customer_notifications_log` (customer phone + name PII); `pages.ecommerce_store_id`
 * is ON DELETE SET NULL so any linked page survives. This is the erasure path for
 * Salla/Zid — which, unlike Shopify's `shop/redact`, have no compliance webhook —
 * and a backstop for any Shopify `shop/redact` that never arrived. Rows with a
 * NULL `uninstalled_at` are skipped (no known deactivation time → not safe to purge).
 */
export async function cleanupInactiveEcommerceStores(
    daysOld: number = INACTIVE_STORE_RETENTION_DAYS,
    batchSize: number = 1000,
): Promise<CleanupResult> {
    return batchDelete(
        'ecommerce_stores', ecommerceStores, ecommerceStores.id,
        and(eq(ecommerceStores.isActive, false), lt(ecommerceStores.uninstalledAt, daysAgo(daysOld))) as SQL,
        batchSize,
    );
}

/** Days a customer-notification log row (customer phone + name PII) is retained. */
export const CUSTOMER_NOTIFICATION_RETENTION_DAYS = 90;

/**
 * GDPR data-minimisation for an ACTIVE store's notification log. purgeStore only
 * erases this table on full store deletion (uninstall + 30d, or Shopify shop/redact);
 * while a store stays connected the rows — customer phone + name captured from
 * order/cart webhooks — would otherwise live forever. The notification lifecycle is
 * minutes/hours, so any row past the window is terminal (its dedup value is long spent),
 * safe to hard-delete.
 */
export async function cleanupCustomerNotificationLogs(
    daysOld: number = CUSTOMER_NOTIFICATION_RETENTION_DAYS,
    batchSize: number = 1000,
): Promise<CleanupResult> {
    return batchDelete(
        'customer_notifications_log', customerNotificationsLog, customerNotificationsLog.id,
        lt(customerNotificationsLog.createdAt, daysAgo(daysOld)) as SQL,
        batchSize,
    );
}

/** Days an email_sends row keeps its rendered body before the PII-bearing body is blanked. */
export const EMAIL_BODY_RETENTION_DAYS = 30;

/**
 * Blank `email_sends.html_body` (contains lead names/phones) older than the window —
 * the retention the schema TODO called for. The row itself is kept as a delivery-audit
 * record; only the PII-bearing body is cleared. `html_body` is NOT NULL, so it's set to
 * '' (not NULL). Guarded by `ne('')` so already-blanked rows aren't rewritten.
 */
export async function cleanupEmailBodies(daysOld: number = EMAIL_BODY_RETENTION_DAYS): Promise<CleanupResult> {
    try {
        const result = await db.update(emailSends)
            .set({ htmlBody: '' })
            .where(and(lt(emailSends.createdAt, daysAgo(daysOld)), ne(emailSends.htmlBody, '')))
            .returning({ id: emailSends.id });
        return { table: 'email_sends', deletedCount: result.length };
    } catch (error) {
        return {
            table: 'email_sends',
            deletedCount: 0,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

/**
 * Days a Needs-Attention MESSAGE stays in the merchant's queue before it is auto-resolved.
 *
 * Measured on production `messages` (2026-08-13, 90 days, 1,057 individually resolved
 * items): **93% of everything a merchant ever resolves is resolved within 7 days** — the
 * median is 4 hours. Past that the item is not pending, it is abandoned: the open message
 * queue was 23,660 with 68% older than 30 days, spread across paying pages (Nourva 7,900,
 * الفريق الدمشقي 2,489), not one dead account. The 7-day window gives up 7.1% of historical
 * message resolutions — the trade the owner took explicitly over 14 days (3.7%) and 30 (2.2%).
 *
 * ⚠️ Those figures describe `messages` ONLY. See the scope note on the function.
 */
export const ATTENTION_QUEUE_RETENTION_DAYS = 7;

/**
 * Auto-resolve Needs-Attention MESSAGES older than the window, across every page.
 *
 * ## Scope: messages only, deliberately (correction to D-078, see D-079)
 *
 * The first version also swept `comments` and `instagram_comments`. The evidence never
 * covered them: comments were 31,885 of the affected rows to messages' 24,243, so the
 * ruling was made on 43% of what it governed. Re-measured afterwards, and excluding the
 * sweep's own bulk minute, only **146 comments had ever been individually resolved in 90
 * days** — 57.5% of them within 7 days, against 93% for messages. On that evidence the
 * window costs ~40% of comment resolutions, not 7.1%, and 146 rows is no mandate at all.
 * Comments therefore stay out until they are measured on their own terms.
 *
 * ## It RESOLVES; it never deletes, never clears the flag, and never touches updated_at
 *
 * `needs_attention` and `flag_reason` survive because the queue is what the MERCHANT works
 * while the flags and their stored customer questions (`flag_meta`) are what reply quality
 * is measured from — on Port Said (2026-08-12), 60% of a 188-item queue proved to be one
 * fixable KB gap, visible only because the flags outlived the clear.
 *
 * ⚠️ `updated_at` is deliberately NOT written, which is where this stops mirroring the
 * merchant's own resolve button. That column is the schema's only proxy for "resolved at"
 * (`services/admin/metrics.ts`), and the first release stamped it on 56,147 rows — making
 * sweep-resolved rows indistinguishable from merchant-resolved ones and destroying the very
 * measurement D-078 promised to repeat. Leaving it alone preserves the proxy AND makes an
 * expired row identifiable (resolved, but `updated_at` still back at its original write).
 * Nothing reads these columns for behaviour, so omitting the write is free.
 *
 * Age is taken from `created_at`: a flag ages from when the customer wrote, not from the
 * last unrelated write that touched the row.
 *
 * Returns the affected workspace ids so the caller can invalidate their stats caches —
 * `services/statsCache.ts` requires every mutation of these counts to do so, and the
 * Needs-Attention chip has no polling fallback.
 */
export async function expireStaleAttentionItems(
    daysOld: number = ATTENTION_QUEUE_RETENTION_DAYS,
): Promise<CleanupResult & { workspaceIds: string[] }> {
    const cutoff = daysAgo(daysOld);
    try {
        const rows = await db.update(messages)
            .set({ resolved: true })
            .where(and(
                eq(messages.needsAttention, true),
                eq(messages.resolved, false),
                lt(messages.createdAt, cutoff),
            ))
            .returning({ workspaceId: messages.workspaceId });
        const workspaceIds = [...new Set(rows.map(r => r.workspaceId).filter((w): w is string => !!w))];
        return { table: 'attention_queue', deletedCount: rows.length, workspaceIds };
    } catch (error) {
        return {
            table: 'attention_queue',
            deletedCount: 0,
            workspaceIds: [],
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

/**
 * Run all cleanup tasks
 * @param options - Configuration options including retention days
 * @param logger - Optional logger (pass Fastify request.log for proper logging)
 */
export async function runAllCleanupTasks(
    options?: {
        aiCacheDays?: number;
        logsDays?: number;
        usageLogsDays?: number;
        inactiveStoreDays?: number;
        customerNotificationDays?: number;
        emailBodyDays?: number;
        attentionQueueDays?: number;
    },
    logger: Logger = noopLogger
): Promise<CleanupResult[]> {
    const {
        aiCacheDays = 30,
        logsDays = 90,
        usageLogsDays = 180,
        inactiveStoreDays = INACTIVE_STORE_RETENTION_DAYS,
        customerNotificationDays = CUSTOMER_NOTIFICATION_RETENTION_DAYS,
        emailBodyDays = EMAIL_BODY_RETENTION_DAYS,
        attentionQueueDays = ATTENTION_QUEUE_RETENTION_DAYS,
    } = options || {};

    logger.info('[Cleanup] Starting database cleanup tasks...');

    const results = await Promise.all([
        cleanupAiCache(aiCacheDays),
        cleanupSemanticCache(),
        cleanupLogs(logsDays),
        cleanupUsageLogs(usageLogsDays),
        cleanupRefreshTokens(),
        cleanupOtpCodes(),
        cleanupInactiveEcommerceStores(inactiveStoreDays),
        cleanupCustomerNotificationLogs(customerNotificationDays),
        cleanupEmailBodies(emailBodyDays),
        expireStaleAttentionItems(attentionQueueDays),
    ]);

    // The attention sweep mutates the Needs-Attention counts, so it owes the same cache
    // invalidation every resolve/unresolve controller path performs. Skipping it leaves
    // the chip showing a stale number over an already-emptied list — the exact
    // chip-shows-N/list-shows-0 defect `services/statsCache.ts` exists to prevent, and the
    // chip query has no polling fallback to self-heal.
    const attention = results[results.length - 1] as CleanupResult & { workspaceIds?: string[] };
    for (const workspaceId of attention.workspaceIds ?? []) {
        invalidateEndpointStatsCaches(workspaceId);
    }

    // Log results
    for (const result of results) {
        if (result.error) {
            logger.error(`[Cleanup] Error cleaning ${result.table}: ${result.error}`);
        } else {
            logger.info(`[Cleanup] Cleaned ${result.deletedCount} rows from ${result.table}`);
        }
    }
    
    return results;
}

/**
 * Get AI cache statistics
 */
export async function getAiCacheStats(): Promise<{
    totalEntries: number;
    totalHits: number;
    oldestEntry: Date | null;
    newestEntry: Date | null;
}> {
    // Bare sql<> select fields bypass drizzle's column mappers (noopDecoder), and
    // drizzle >=0.30 installs identity parsers on the client — so these aggregates
    // arrive as raw Postgres text ("2026-08-02 06:54:44.743+00"), not Date objects.
    const stats = await db
        .select({
            count: sql<number>`count(*)`,
            totalHits: sql<number>`coalesce(sum(hit_count), 0)`,
            oldest: sql<string | Date | null>`min(created_at)`,
            newest: sql<string | Date | null>`max(last_used_at)`,
        })
        .from(aiCache);

    return {
        totalEntries: Number(stats[0]?.count) || 0,
        totalHits: Number(stats[0]?.totalHits) || 0,
        oldestEntry: stats[0]?.oldest ? new Date(stats[0].oldest) : null,
        newestEntry: stats[0]?.newest ? new Date(stats[0].newest) : null,
    };
}
