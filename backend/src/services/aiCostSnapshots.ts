/**
 * Persistence + read models for OpenAI's authoritative daily cost snapshots
 * (table ai_cost_snapshots). Powers the admin AI Cost panel's "what OpenAI bills
 * us" + reconciliation sections, and supplies the org-total burn for credit runway.
 *
 * Key distinction from analytics.getGlobalAiCostByPipeline (ai_usage_log): that is
 * OUR per-reply estimate, prod-only, no api_key_id. THIS is OpenAI's invoice, split
 * by api_key_id (prod vs eval/dev) — the credit wallet is drained by ALL keys.
 */
import { db } from '../db';
import { aiCostSnapshots } from '../db/schema';
import { and, gte, lte, sql } from 'drizzle-orm';
import { config } from '../config';
import { resolvePeriodRange, analyticsService, type AdminUserAiCostPeriod } from './analytics';
import { round2, utcDateStr } from './aiCostShared';
import type { OpenAiCostRow } from './openaiCosts';

/** Human label for a known api_key_id (prod vs eval/dev), else 'other'. */
export type ApiKeyLabel = 'production' | 'eval_dev' | 'other';
export function apiKeyLabel(apiKeyId: string): ApiKeyLabel {
    if (apiKeyId && apiKeyId === config.openaiAdmin.prodKeyId) return 'production';
    if (apiKeyId && apiKeyId === config.openaiAdmin.evalKeyId) return 'eval_dev';
    return 'other';
}

/**
 * Idempotent bulk upsert keyed on the natural grain (usage_date, api_key_id, model,
 * line_item). Re-running a day overwrites — so the daily cron can safely re-fetch a
 * trailing window to absorb late OpenAI cost adjustments.
 */
export async function upsertSnapshots(rows: OpenAiCostRow[]): Promise<number> {
    if (rows.length === 0) return 0;
    const values = rows.map(r => ({
        usageDate: r.usageDate,
        apiKeyId: r.apiKeyId,
        model: r.model,
        lineItem: r.lineItem,
        amountUsd: r.amountUsd.toFixed(6), // numeric column → string
        source: 'openai_costs',
    }));
    await db.insert(aiCostSnapshots).values(values).onConflictDoUpdate({
        target: [aiCostSnapshots.usageDate, aiCostSnapshots.apiKeyId, aiCostSnapshots.model, aiCostSnapshots.lineItem],
        set: {
            amountUsd: sql`excluded.amount_usd`,
            source: sql`excluded.source`,
            fetchedAt: sql`now()`,
        },
    });
    return values.length;
}

export interface AdminAiBillingReport {
    period: AdminUserAiCostPeriod;
    rangeStart: string;
    rangeEnd: string;
    /** Authoritative org total for the window. */
    totalUsd: number;
    byMonth: Array<{ month: string; costUsd: number }>;
    byModel: Array<{ model: string; costUsd: number }>;
    byApiKey: Array<{ apiKeyId: string; label: ApiKeyLabel; costUsd: number }>;
    /** True until the snapshot cron has populated any rows in range. */
    empty: boolean;
}

/** Read the snapshot rows for a period and roll them up by month / model / api-key. */
export async function getBilling(period: AdminUserAiCostPeriod = '30d'): Promise<AdminAiBillingReport> {
    const { rangeStart, rangeEnd } = resolvePeriodRange(period);
    // rangeEnd is an EXCLUSIVE timestamp. usageDate is a whole UTC day, so the
    // inclusive last day in range is the date of (rangeEnd − 1ms): for a now-based
    // period (rangeEnd = mid-day today) that's today (today IS included); for a
    // month-boundary period (rangeEnd = midnight of the next month) it's the last
    // day of the previous month (the boundary day is correctly excluded).
    const endDateInclusive = utcDateStr(new Date(rangeEnd.getTime() - 1));
    const rows = await db
        .select({
            // Cast date → text so the pg driver returns 'YYYY-MM-DD' strings, not JS
            // Date objects (which would be local-tz midnight and break .slice + month
            // bucketing). Timezone-safe vs reading the Date and re-formatting.
            usageDate: sql<string>`${aiCostSnapshots.usageDate}::text`,
            apiKeyId: aiCostSnapshots.apiKeyId,
            model: aiCostSnapshots.model,
            amountUsd: aiCostSnapshots.amountUsd,
        })
        .from(aiCostSnapshots)
        .where(and(
            gte(aiCostSnapshots.usageDate, utcDateStr(rangeStart)),
            lte(aiCostSnapshots.usageDate, endDateInclusive),
        ));

    const byMonth = new Map<string, number>();
    const byModel = new Map<string, number>();
    const byApiKey = new Map<string, number>();
    let total = 0;

    for (const r of rows) {
        const amount = Number(r.amountUsd) || 0;
        total += amount;
        byMonth.set(r.usageDate.slice(0, 7), (byMonth.get(r.usageDate.slice(0, 7)) ?? 0) + amount);
        const model = r.model || 'unknown';
        byModel.set(model, (byModel.get(model) ?? 0) + amount);
        byApiKey.set(r.apiKeyId, (byApiKey.get(r.apiKeyId) ?? 0) + amount);
    }

    return {
        period,
        rangeStart: rangeStart.toISOString(),
        rangeEnd: rangeEnd.toISOString(),
        totalUsd: round2(total),
        byMonth: Array.from(byMonth, ([month, costUsd]) => ({ month, costUsd: round2(costUsd) })).sort((a, b) => a.month.localeCompare(b.month)),
        byModel: Array.from(byModel, ([model, costUsd]) => ({ model, costUsd: round2(costUsd) })).sort((a, b) => b.costUsd - a.costUsd),
        byApiKey: Array.from(byApiKey, ([apiKeyId, costUsd]) => ({ apiKeyId, label: apiKeyLabel(apiKeyId), costUsd: round2(costUsd) })).sort((a, b) => b.costUsd - a.costUsd),
        empty: rows.length === 0,
    };
}

export interface AdminAiReconciliation {
    period: AdminUserAiCostPeriod;
    /** OpenAI authoritative total for the production key only (like-for-like with our log). */
    openaiProdUsd: number;
    /** Our ai_usage_log estimate (prod traffic only). */
    ourEstimateUsd: number;
    /** openaiProdUsd − ourEstimateUsd. */
    deltaUsd: number;
    /** delta as a % of the OpenAI prod figure (null when prod is 0). */
    deltaPct: number | null;
    /** Full OpenAI org total (incl. eval/dev) — for context; NOT compared to our log. */
    openaiOrgUsd: number;
    /** True when no production key id is configured (prod-vs-our comparison unavailable). */
    prodKeyUnknown: boolean;
}

/**
 * Compare like-for-like: OpenAI's PRODUCTION-key spend vs our ai_usage_log estimate
 * (both prod-only). The org total (incl. eval/dev) is reported separately so the two
 * aren't conflated — that ~33% "gap" is eval/dev by design, not a tracking error.
 */
export async function getReconciliation(period: AdminUserAiCostPeriod = '30d'): Promise<AdminAiReconciliation> {
    const billing = await getBilling(period);
    const ourReport = await analyticsService.getGlobalAiCostByPipeline(period);

    const prodKeyId = config.openaiAdmin.prodKeyId;
    const openaiProdUsd = round2(billing.byApiKey.filter(k => k.apiKeyId === prodKeyId).reduce((s, k) => s + k.costUsd, 0));
    const ourEstimateUsd = round2(ourReport.totals.costUsd);
    const deltaUsd = round2(openaiProdUsd - ourEstimateUsd);

    return {
        period,
        openaiProdUsd,
        ourEstimateUsd,
        deltaUsd,
        deltaPct: openaiProdUsd > 0 ? Math.round((deltaUsd / openaiProdUsd) * 1000) / 10 : null,
        openaiOrgUsd: billing.totalUsd,
        prodKeyUnknown: !prodKeyId,
    };
}
