/**
 * OpenAI credit runway + proactive "credits low" early warning for the admin AI
 * Cost panel. Fills the gap the 2026-06-28 outage exposed: the system recovers
 * from insufficient_quota (park + retry) but never warned BEFORE the wallet hit 0.
 *
 * Runway is computed from the OpenAI Costs-API org total (ALL api keys — the credit
 * wallet is drained by prod AND eval/dev), NOT ai_usage_log (prod-only). Using
 * prod-only would overestimate runway and warn too late. Because OpenAI exposes no
 * remaining-balance API, the admin anchors a known balance ("$X as of date Y") and
 * we subtract org spend since then.
 */
import * as Sentry from '@sentry/node';
import { db } from '../db';
import { aiCreditBalance, aiCostSnapshots } from '../db/schema';
import { and, eq, gte, lt, desc, sql } from 'drizzle-orm';
import { config } from '../config';
import { redis } from '../lib/redis';
import { emailService } from './email';

export type AiCostSeverity = 'ok' | 'warning' | 'critical';

export interface AiCreditRunway {
    /** False until an admin sets a balance anchor (runway can't be computed without it). */
    configured: boolean;
    balanceUsd: number | null;
    anchoredAt: string | null;
    /** OpenAI org spend (all keys) since the anchor date. */
    orgSpentSinceAnchorUsd: number;
    remainingUsd: number | null;
    /** Avg org $/day over the last config.aiCostMonitoring.rollingRateDays. */
    rollingDailyRateUsd: number;
    /** remaining ÷ daily rate; null when rate is 0 or unconfigured. */
    runwayDays: number | null;
    severity: AiCostSeverity;
    /** True when the reactive insufficient_quota alert is currently active (already out). */
    currentlyParking: boolean;
}

const round2 = (v: number) => Math.round(v * 100) / 100;
function utcDateStr(d: Date): string { return d.toISOString().slice(0, 10); }

/** Latest balance anchor row (most recently set wins), or null if never set. */
export async function getBalanceAnchor(): Promise<{ balanceUsd: number; anchoredAt: string; note: string | null } | null> {
    const [row] = await db
        // anchoredAt cast date → text so it's a 'YYYY-MM-DD' string (the pg driver
        // would otherwise return a JS Date) — it's compared as a date string in
        // sumSnapshots and surfaced verbatim in the runway API response + UI.
        .select({ balanceUsd: aiCreditBalance.balanceUsd, anchoredAt: sql<string>`${aiCreditBalance.anchoredAt}::text`, note: aiCreditBalance.note })
        .from(aiCreditBalance)
        .orderBy(desc(aiCreditBalance.updatedAt))
        .limit(1);
    if (!row) return null;
    return { balanceUsd: Number(row.balanceUsd), anchoredAt: row.anchoredAt, note: row.note };
}

/** Record a new balance anchor (insert-only; the latest row wins, history retained). */
export async function setBalanceAnchor(opts: { balanceUsd: number; anchoredAt: string; note?: string | null; updatedBy?: string | null }): Promise<void> {
    await db.insert(aiCreditBalance).values({
        balanceUsd: opts.balanceUsd.toFixed(2),
        anchoredAt: opts.anchoredAt,
        note: opts.note ?? null,
        updatedBy: opts.updatedBy ?? null,
    });
}

async function sumSnapshots(fromDate: string): Promise<number> {
    const [row] = await db
        .select({ total: sql<string>`COALESCE(SUM(${aiCostSnapshots.amountUsd}), 0)` })
        .from(aiCostSnapshots)
        .where(gte(aiCostSnapshots.usageDate, fromDate));
    return Number(row?.total ?? 0);
}

async function isCurrentlyParking(): Promise<boolean> {
    try {
        return (await redis.get('alert:openai_quota_exhausted')) !== null;
    } catch {
        return false; // Redis down — don't fabricate a parking state.
    }
}

/** Compute the credit runway + severity from the anchor, snapshots, and parking state. */
export async function computeRunway(now: Date = new Date()): Promise<AiCreditRunway> {
    const cfg = config.aiCostMonitoring;
    const currentlyParking = await isCurrentlyParking();
    const anchor = await getBalanceAnchor();

    // Rolling daily org rate over the last N days (independent of the anchor).
    const rollingStart = utcDateStr(new Date(now.getTime() - cfg.rollingRateDays * 86400_000));
    const rollingSpent = await sumSnapshots(rollingStart);
    const rollingDailyRateUsd = round2(rollingSpent / cfg.rollingRateDays);

    if (!anchor) {
        return {
            configured: false,
            balanceUsd: null, anchoredAt: null,
            orgSpentSinceAnchorUsd: 0, remainingUsd: null,
            rollingDailyRateUsd, runwayDays: null,
            severity: currentlyParking ? 'critical' : 'ok',
            currentlyParking,
        };
    }

    const orgSpentSinceAnchorUsd = round2(await sumSnapshots(anchor.anchoredAt));
    const remainingUsd = round2(anchor.balanceUsd - orgSpentSinceAnchorUsd);
    const runwayDays = rollingDailyRateUsd > 0 ? Math.round((remainingUsd / rollingDailyRateUsd) * 10) / 10 : null;

    let severity: AiCostSeverity = 'ok';
    if (currentlyParking || remainingUsd <= 0 || (runwayDays !== null && runwayDays < cfg.criticalRunwayDays)) {
        severity = 'critical';
    } else if (remainingUsd < cfg.warnRemainingUsd || (runwayDays !== null && runwayDays < cfg.warnRunwayDays)) {
        severity = 'warning';
    }

    return {
        configured: true,
        balanceUsd: anchor.balanceUsd,
        anchoredAt: anchor.anchoredAt,
        orgSpentSinceAnchorUsd,
        remainingUsd,
        rollingDailyRateUsd,
        runwayDays,
        severity,
        currentlyParking,
    };
}

/**
 * Evaluate runway and fire a throttled proactive alert when warning/critical.
 * Reuses the alertQuotaExhausted pattern (Redis SET-NX dedup + Sentry + admin
 * email) but on a SEPARATE key so it never collides with the reactive alert.
 * Called by the daily snapshot cron after snapshots are upserted.
 */
export async function evaluateAndAlert(now: Date = new Date()): Promise<AiCreditRunway> {
    const runway = await computeRunway(now);
    if (runway.severity === 'ok') return runway;

    const dedupKey = 'alert:openai_credit_low';
    let shouldAlert = true;
    try {
        const acquired = await redis.set(dedupKey, '1', 'EX', config.aiCostMonitoring.creditLowAlertCooldownSeconds, 'NX');
        shouldAlert = acquired === 'OK';
    } catch {
        // Redis unavailable — still alert (a duplicate beats silence before an outage).
    }
    if (!shouldAlert) return runway;

    const remaining = runway.remainingUsd ?? 0;
    const days = runway.runwayDays;
    Sentry.captureMessage('OpenAI credit low — top up before the wallet hits zero', {
        level: runway.severity === 'critical' ? 'error' : 'warning',
        tags: { alert: 'openai_credit_low', severity: runway.severity },
        extra: { remainingUsd: remaining, runwayDays: days, rollingDailyRateUsd: runway.rollingDailyRateUsd, currentlyParking: runway.currentlyParking },
    });

    const admins = config.adminEmails;
    if (admins.length > 0) {
        const daysText = days === null ? 'unknown' : `~${days}`;
        const html = `<p><b>OpenAI credit is running low.</b> Top up before it hits zero — at zero, all auto-replies stop (the 2026-06-28 outage).</p>`
            + `<p>Estimated remaining: <b>$${remaining.toFixed(2)}</b><br/>Runway at current rate: <b>${daysText} days</b> ($${runway.rollingDailyRateUsd.toFixed(2)}/day)</p>`
            + (runway.currentlyParking ? `<p><b>⚠️ Replies are ALREADY parking on insufficient_quota right now.</b></p>` : '')
            + `<p><b>Action:</b> add credit / enable auto-recharge in the OpenAI billing dashboard, then update the balance in the admin AI Cost panel.</p>`;
        for (const to of admins) {
            void emailService.send({
                to,
                subject: runway.severity === 'critical'
                    ? '🚨 Jawab24: OpenAI credit critically low — top up now'
                    : '⚠️ Jawab24: OpenAI credit running low',
                html,
                type: 'transactional',
            }).catch(() => { /* best-effort; never throw from the cron */ });
        }
    }

    return runway;
}

export interface SpendSpike {
    spike: boolean;
    /** The latest COMPLETE day evaluated (UTC, yesterday), or null if unavailable. */
    day: string | null;
    dayUsd: number;
    /** Avg org $/day over the baseline window preceding `day`. */
    baselineDailyUsd: number;
    /** dayUsd ÷ baselineDailyUsd; null when baseline is 0. */
    ratio: number | null;
}

async function sumSnapshotsBetween(fromInclusive: string, toExclusive: string): Promise<number> {
    const [row] = await db
        .select({ total: sql<string>`COALESCE(SUM(${aiCostSnapshots.amountUsd}), 0)` })
        .from(aiCostSnapshots)
        .where(and(gte(aiCostSnapshots.usageDate, fromInclusive), lt(aiCostSnapshots.usageDate, toExclusive)));
    return Number(row?.total ?? 0);
}

async function sumSnapshotsForDay(day: string): Promise<number> {
    const [row] = await db
        .select({ total: sql<string>`COALESCE(SUM(${aiCostSnapshots.amountUsd}), 0)` })
        .from(aiCostSnapshots)
        .where(eq(aiCostSnapshots.usageDate, day));
    return Number(row?.total ?? 0);
}

/**
 * Detect an org spend spike: the latest complete day (yesterday, UTC) vs the
 * average of the `spendSpikeBaselineDays` days before it. A spike requires the day
 * to clear the min-daily floor AND exceed `spendSpikeMultiplier`× the baseline.
 * Baseline-zero (fresh usage) is intentionally NOT a spike — ramp-up shouldn't page.
 * Uses the Costs-API org total (all keys), same wallet the credit runway tracks.
 */
export async function detectSpendSpike(now: Date = new Date()): Promise<SpendSpike> {
    const cfg = config.aiCostMonitoring;
    const dayMs = 86_400_000;
    const day = utcDateStr(new Date(now.getTime() - dayMs)); // yesterday = latest complete day
    const baselineStart = utcDateStr(new Date(now.getTime() - (cfg.spendSpikeBaselineDays + 1) * dayMs));

    const dayUsd = round2(await sumSnapshotsForDay(day));
    // Baseline = [baselineStart, day) — the N days immediately before `day`.
    const baselineDailyUsd = round2((await sumSnapshotsBetween(baselineStart, day)) / cfg.spendSpikeBaselineDays);
    const ratio = baselineDailyUsd > 0 ? Math.round((dayUsd / baselineDailyUsd) * 10) / 10 : null;

    const spike = dayUsd >= cfg.spendSpikeMinDailyUsd
        && baselineDailyUsd > 0
        && dayUsd > cfg.spendSpikeMultiplier * baselineDailyUsd;

    return { spike, day, dayUsd, baselineDailyUsd, ratio };
}

/**
 * Evaluate the spend spike and fire a throttled alert on a SEPARATE dedup key from
 * the credit-low / insufficient_quota alerts. Called by the daily sync after
 * snapshots are upserted. Returns the spike result for the caller/UI.
 */
export async function evaluateSpendSpikeAndAlert(now: Date = new Date()): Promise<SpendSpike> {
    const result = await detectSpendSpike(now);
    if (!result.spike) return result;

    let shouldAlert = true;
    try {
        const acquired = await redis.set('alert:openai_spend_spike', '1', 'EX', config.aiCostMonitoring.spendSpikeAlertCooldownSeconds, 'NX');
        shouldAlert = acquired === 'OK';
    } catch {
        // Redis down — alert anyway (a duplicate beats missing a runaway spend).
    }
    if (!shouldAlert) return result;

    Sentry.captureMessage('OpenAI spend spike — daily cost well above baseline', {
        level: 'warning',
        tags: { alert: 'openai_spend_spike' },
        extra: { day: result.day, dayUsd: result.dayUsd, baselineDailyUsd: result.baselineDailyUsd, ratio: result.ratio },
    });

    const admins = config.adminEmails;
    if (admins.length > 0) {
        const ratioText = result.ratio === null ? 'n/a' : `${result.ratio}×`;
        const html = `<p><b>OpenAI spend spiked on ${result.day}.</b></p>`
            + `<p>That day: <b>$${result.dayUsd.toFixed(2)}</b> vs a ${config.aiCostMonitoring.spendSpikeBaselineDays}-day baseline of <b>$${result.baselineDailyUsd.toFixed(2)}/day</b> (<b>${ratioText}</b>).</p>`
            + `<p><b>Check:</b> a runaway loop, a model misconfig, or unusual traffic. See /admin/ai-cost for the by-feature/by-model breakdown.</p>`;
        for (const to of admins) {
            void emailService.send({
                to,
                subject: '⚠️ Jawab24: OpenAI spend spike detected',
                html,
                type: 'transactional',
            }).catch(() => { /* best-effort */ });
        }
    }

    return result;
}
