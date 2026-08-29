/**
 * Throttled admin alert dispatch — the one shape for proactive platform alerts:
 * Redis SET-NX dedup (per `dedupKey`), one Sentry message, and a fire-and-forget
 * email to every admin. Used by the AI cost alerts (credit-low, spend-spike) and
 * the reply-queue backlog alert. The reactive `alertQuotaExhausted` in ai.ts keeps
 * its own inline copy deliberately — it sits on the hot reply path.
 */
import * as Sentry from '@sentry/node';
import { config } from '../config';
import { redis } from '../lib/redis';
import { emailService } from './email';

export async function sendThrottledAdminAlert(opts: {
    dedupKey: string;
    cooldownSeconds: number;
    level: 'info' | 'warning' | 'error';
    message: string;
    tags: Record<string, string>;
    extra: Record<string, unknown>;
    subject: string;
    html: string;
}): Promise<void> {
    let shouldAlert = true;
    try {
        const acquired = await redis.set(opts.dedupKey, '1', 'EX', opts.cooldownSeconds, 'NX');
        shouldAlert = acquired === 'OK';
    } catch {
        // Redis unavailable — still alert (a duplicate beats silence before an outage).
    }
    if (!shouldAlert) return;

    Sentry.captureMessage(opts.message, { level: opts.level, tags: opts.tags, extra: opts.extra });
    for (const to of config.adminEmails) {
        void emailService.send({ to, subject: opts.subject, html: opts.html, type: 'transactional' })
            .catch(() => { /* best-effort; never throw from the cron */ });
    }
}
