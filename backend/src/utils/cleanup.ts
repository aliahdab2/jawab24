/**
 * Database Cleanup Tasks
 * Run these periodically to maintain database health
 */

import { db } from '../db';
import { aiCache, logs, usageLogs, refreshTokens, otpCodes } from '../db/schema';
import { lt, sql } from 'drizzle-orm';
import { Logger, noopLogger, CleanupResult } from '../types';

/**
 * Clean up old AI cache entries
 * Removes entries not used in the specified number of days
 * Uses batch deletion to avoid locking issues
 */
export async function cleanupAiCache(daysOld: number = 30, batchSize: number = 1000): Promise<CleanupResult> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);
    
    let totalDeleted = 0;
    
    try {
        // Delete in batches to avoid long-running transactions
        let deletedInBatch: number;
        do {
            const result = await db
                .delete(aiCache)
                .where(lt(aiCache.lastUsedAt, cutoffDate))
                .returning({ id: aiCache.id });
            
            deletedInBatch = result.length;
            totalDeleted += deletedInBatch;
            
            // If we deleted a full batch, there might be more
        } while (deletedInBatch >= batchSize);
        
        return {
            table: 'ai_cache',
            deletedCount: totalDeleted,
        };
    } catch (error) {
        return {
            table: 'ai_cache',
            deletedCount: totalDeleted,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

/**
 * Clean up old logs
 * Removes log entries older than the specified number of days
 */
export async function cleanupLogs(daysOld: number = 90, batchSize: number = 1000): Promise<CleanupResult> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);
    
    let totalDeleted = 0;
    
    try {
        let deletedInBatch: number;
        do {
            const result = await db
                .delete(logs)
                .where(lt(logs.createdAt, cutoffDate))
                .returning({ id: logs.id });
            
            deletedInBatch = result.length;
            totalDeleted += deletedInBatch;
        } while (deletedInBatch >= batchSize);
        
        return {
            table: 'logs',
            deletedCount: totalDeleted,
        };
    } catch (error) {
        return {
            table: 'logs',
            deletedCount: totalDeleted,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

/**
 * Clean up old usage logs
 * Removes usage log entries older than the specified number of days
 */
export async function cleanupUsageLogs(daysOld: number = 180, batchSize: number = 1000): Promise<CleanupResult> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);
    
    let totalDeleted = 0;
    
    try {
        let deletedInBatch: number;
        do {
            const result = await db
                .delete(usageLogs)
                .where(lt(usageLogs.createdAt, cutoffDate))
                .returning({ id: usageLogs.id });
            
            deletedInBatch = result.length;
            totalDeleted += deletedInBatch;
        } while (deletedInBatch >= batchSize);
        
        return {
            table: 'usage_logs',
            deletedCount: totalDeleted,
        };
    } catch (error) {
        return {
            table: 'usage_logs',
            deletedCount: totalDeleted,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

/**
 * Clean up expired or revoked refresh tokens
 * Removes tokens that are expired or were revoked more than 7 days ago
 */
export async function cleanupRefreshTokens(): Promise<CleanupResult> {
    const now = new Date();
    let totalDeleted = 0;

    try {
        // Delete expired tokens
        const expired = await db
            .delete(refreshTokens)
            .where(lt(refreshTokens.expiresAt, now))
            .returning({ id: refreshTokens.id });
        totalDeleted += expired.length;

        // Delete tokens revoked more than 7 days ago
        // revokedAt is non-null when revoked (no boolean column)
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 7);
        const revoked = await db
            .delete(refreshTokens)
            .where(lt(refreshTokens.revokedAt, cutoff))
            .returning({ id: refreshTokens.id });
        totalDeleted += revoked.length;

        return { table: 'refresh_tokens', deletedCount: totalDeleted };
    } catch (error) {
        return {
            table: 'refresh_tokens',
            deletedCount: totalDeleted,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

export async function cleanupOtpCodes(): Promise<CleanupResult> {
    try {
        const deleted = await db
            .delete(otpCodes)
            .where(lt(otpCodes.expiresAt, new Date()))
            .returning({ id: otpCodes.id });
        return { table: 'otp_codes', deletedCount: deleted.length };
    } catch (error) {
        return {
            table: 'otp_codes',
            deletedCount: 0,
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
    },
    logger: Logger = noopLogger
): Promise<CleanupResult[]> {
    const {
        aiCacheDays = 30,
        logsDays = 90,
        usageLogsDays = 180,
    } = options || {};
    
    logger.info('[Cleanup] Starting database cleanup tasks...');
    
    const results = await Promise.all([
        cleanupAiCache(aiCacheDays),
        cleanupLogs(logsDays),
        cleanupUsageLogs(usageLogsDays),
        cleanupRefreshTokens(),
        cleanupOtpCodes(),
    ]);
    
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
    const stats = await db
        .select({
            count: sql<number>`count(*)`,
            totalHits: sql<number>`coalesce(sum(hit_count), 0)`,
            oldest: sql<Date>`min(created_at)`,
            newest: sql<Date>`max(last_used_at)`,
        })
        .from(aiCache);
    
    return {
        totalEntries: Number(stats[0]?.count) || 0,
        totalHits: Number(stats[0]?.totalHits) || 0,
        oldestEntry: stats[0]?.oldest || null,
        newestEntry: stats[0]?.newest || null,
    };
}
