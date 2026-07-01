/**
 * Orchestrates one OpenAI cost-sync cycle: pull authoritative daily costs from the
 * Costs API for a trailing window, upsert them into ai_cost_snapshots (idempotent),
 * then evaluate the credit runway and fire the proactive low-credit alert.
 *
 * Shared by the daily cron (index.ts) and the admin "Sync now" button so the
 * fetch→upsert→alert sequence lives in exactly one place. No-ops (configured:false)
 * when the org admin key isn't set — the admin key only ever lives in backend env.
 */
import { config } from '../config';
import { captureError } from '../utils/sentryHelpers';
import { fetchCostRows, isOpenAiCostsConfigured } from './openaiCosts';
import { upsertSnapshots } from './aiCostSnapshots';
import { evaluateAndAlert, evaluateSpendSpikeAndAlert } from './aiCostMonitor';

export interface OpenAiCostSyncResult {
    /** False when no org admin key is configured (nothing was fetched). */
    configured: boolean;
    /** Number of snapshot rows upserted. */
    synced: number;
}

export async function runOpenAiCostSync(trailingDays = 3, now: Date = new Date()): Promise<OpenAiCostSyncResult> {
    if (!config.aiCostMonitoring.enabled || !isOpenAiCostsConfigured()) {
        return { configured: false, synced: 0 };
    }
    const endTime = Math.floor(now.getTime() / 1000);
    const startTime = endTime - trailingDays * 24 * 60 * 60;
    const rows = await fetchCostRows({ startTime, endTime });
    const synced = await upsertSnapshots(rows);
    // Alerts are best-effort — snapshots are already persisted, and one alert
    // failing must not fail the sync or skip the other alert.
    await evaluateAndAlert(now).catch(e => captureError(e, 'credit-runway alert failed', { tags: { cron: 'ai_cost_snapshot' } }));
    await evaluateSpendSpikeAndAlert(now).catch(e => captureError(e, 'spend-spike alert failed', { tags: { cron: 'ai_cost_snapshot' } }));
    return { configured: true, synced };
}
