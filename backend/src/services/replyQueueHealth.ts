/**
 * Reply-queue health: per-job queue-wait sampling + backlog alerting.
 *
 * This is the instrument for the D-016 scaling trigger ("sustained queue
 * wait-time"). The reply worker records how long each job sat in the queue
 * before pickup; a 60s cron evaluates recent p95 wait + live queue depth and
 * fires a throttled admin alert when both consecutive checks breach. The
 * responses (raise REPLY_WORKER_CONCURRENCY, then split queues per channel)
 * are deliberate manual actions — this service only provides the signal.
 *
 * Storage: a capped Redis LIST of "timestamp:waitMs" samples (newest first),
 * following the `metrics:` key convention from pipelineMetrics. Percentiles
 * are computed exactly in JS over the recent window; at reply-queue volumes
 * (a few thousand samples max) that is cheaper than maintaining histograms.
 */
import { config } from '../config';
import { redis } from '../lib/redis';
import { getQueueStats } from '../lib/replyQueue';
import { sendThrottledAdminAlert } from './adminAlerts';

const SAMPLES_KEY = 'metrics:queue_wait:reply';
const MAX_SAMPLES = 2000;
const WINDOW_MINUTES = 15;

export interface ReplyQueueHealth {
    waiting: number;
    active: number;
    delayed: number;
    failed: number;
    /** Null when no samples landed inside the window (idle queue). */
    waitP50Ms: number | null;
    waitP95Ms: number | null;
    waitMaxMs: number | null;
    sampleCount: number;
    windowMinutes: number;
}

/**
 * True queue wait = time between enqueue and pickup, excluding the intentional
 * scheduling delay (reply-delay consolidation, handoff re-enqueue). Clamped at
 * 0 because BullMQ can promote delayed jobs early (manual promote, resume).
 */
export function computeQueueWaitMs(
    job: { timestamp: number; opts?: { delay?: number } },
    now: number = Date.now(),
): number {
    return Math.max(0, now - job.timestamp - (job.opts?.delay ?? 0));
}

/**
 * Record one queue-wait sample. Fire-and-forget: never throws, never blocks
 * the reply pipeline (same contract as pipelineMetrics.record).
 */
export function recordQueueWaitSample(waitMs: number, now: number = Date.now()): void {
    redis.lpush(SAMPLES_KEY, `${now}:${Math.round(waitMs)}`)
        .then(() => redis.ltrim(SAMPLES_KEY, 0, MAX_SAMPLES - 1))
        .catch(() => { /* metrics must never break replies */ });
}

/** Nearest-rank percentile over an ascending-sorted array. */
function percentile(sortedAsc: number[], p: number): number {
    const rank = Math.max(1, Math.ceil(p * sortedAsc.length));
    return sortedAsc[rank - 1];
}

/**
 * Live queue depth + wait percentiles over the last WINDOW_MINUTES.
 * Throws on Redis failure — callers decide how to degrade (the analytics
 * route returns `queue: null`; the cron routes errors to captureError).
 */
export async function getQueueHealth(now: number = Date.now()): Promise<ReplyQueueHealth> {
    const [stats, rawSamples] = await Promise.all([
        getQueueStats(),
        redis.lrange(SAMPLES_KEY, 0, MAX_SAMPLES - 1),
    ]);

    const cutoff = now - WINDOW_MINUTES * 60_000;
    const waits: number[] = [];
    for (const entry of rawSamples) {
        const sep = entry.indexOf(':');
        if (sep <= 0) continue;
        const ts = Number(entry.slice(0, sep));
        const wait = Number(entry.slice(sep + 1));
        if (!Number.isFinite(ts) || !Number.isFinite(wait)) continue;
        // Filter (not early-break): concurrent workers can LPUSH a few ms out of
        // timestamp order, so newest-first is only approximate at the boundary.
        if (ts < cutoff) continue;
        waits.push(wait);
    }
    waits.sort((a, b) => a - b);

    return {
        waiting: stats.waiting,
        active: stats.active,
        delayed: stats.delayed,
        failed: stats.failed,
        waitP50Ms: waits.length ? percentile(waits, 0.5) : null,
        waitP95Ms: waits.length ? percentile(waits, 0.95) : null,
        waitMaxMs: waits.length ? waits[waits.length - 1] : null,
        sampleCount: waits.length,
        windowMinutes: WINDOW_MINUTES,
    };
}

// A single breach can be a harmless burst clearing itself (measured 2026-07-04:
// micro-bursts produce ~2s waits that vanish within seconds). Requiring two
// consecutive breaches (~2 min apart) is what makes the alert mean "sustained".
// Module state is safe: the backend runs single-instance and the cron lives in
// this one process (same assumption as the SET-NX alert cooldowns).
let consecutiveBreaches = 0;
let evalInFlight = false;

/** Test hook — the breach counter and in-flight flag are module state. */
export function resetBreachStateForTests(): void {
    consecutiveBreaches = 0;
    evalInFlight = false;
}

/**
 * Cron entrypoint: evaluate the queue and fire the throttled backlog alert on
 * the second consecutive breach. Returns the health snapshot for logging.
 */
export async function evaluateQueueBacklogAndAlert(now: Date = new Date()): Promise<ReplyQueueHealth | null> {
    const cfg = config.replyQueueHealth;
    if (!cfg.enabled) return null;

    // Overlap guard: if Redis stalls past the interval, stacked evaluations would
    // resolve together and pump the breach counter toward a spurious alert.
    if (evalInFlight) return null;
    evalInFlight = true;
    try {
        return await evaluateOnce(cfg, now);
    } finally {
        evalInFlight = false;
    }
}

async function evaluateOnce(
    cfg: typeof config.replyQueueHealth,
    now: Date,
): Promise<ReplyQueueHealth> {
    const health = await getQueueHealth(now.getTime());
    const breach = health.waiting >= cfg.waitingThreshold
        || (health.waitP95Ms !== null && health.waitP95Ms >= cfg.waitP95ThresholdMs);

    if (!breach) {
        consecutiveBreaches = 0;
        return health;
    }

    consecutiveBreaches += 1;
    if (consecutiveBreaches < 2) return health;

    const p95Text = health.waitP95Ms === null ? 'n/a' : `${(health.waitP95Ms / 1000).toFixed(1)}s`;
    await sendThrottledAdminAlert({
        dedupKey: 'alert:reply_queue_backlog',
        cooldownSeconds: cfg.alertCooldownSeconds,
        level: 'error',
        message: 'Reply queue backlog — customer replies are delayed',
        tags: { alert: 'reply_queue_backlog' },
        extra: {
            waiting: health.waiting,
            active: health.active,
            delayed: health.delayed,
            waitP95Ms: health.waitP95Ms,
            waitMaxMs: health.waitMaxMs,
            sampleCount: health.sampleCount,
        },
        subject: '🚨 Jawab24: reply queue backed up — replies are delayed',
        html: `<p><b>The reply queue is backed up.</b> Incoming messages are waiting instead of being answered.</p>`
            + `<p>Waiting jobs: <b>${health.waiting}</b> · p95 wait (last ${health.windowMinutes} min): <b>${p95Text}</b> · active: ${health.active}</p>`
            + `<p><b>Action (per DECISIONS.md D-016):</b> first raise <code>REPLY_WORKER_CONCURRENCY</code> (currently defaults to 8) and redeploy; `
            + `if backlogs persist across bursts, consider the uniform per-channel queue split.</p>`
            + `<p>Live view: /admin/observability → Reply Queue.</p>`,
    });

    return health;
}
