/**
 * Recurring background job registration.
 *
 * Every periodic job in `index.ts` needs the same four things: a repeating
 * timer, a delayed first run so boot isn't blocked, a log line on failure, and
 * a Sentry capture tagged with the job name. Written by hand that is ~14 lines
 * per job, and it had been copy-pasted four times — with the failure handling
 * silently drifting between copies (this is exactly what Rule 10.8 forbids).
 *
 * A rejected run is caught and reported, never rethrown: an unhandled rejection
 * inside a timer callback would take the process down, and one bad nightly run
 * must not kill a healthy server.
 */
import { captureError } from '../utils/sentryHelpers';

export interface RecurringJobOptions {
    /**
     * Log prefix identifying the job, e.g. `[LeadDigest]`. Appears verbatim in
     * both the server log line and the Sentry message.
     */
    label: string;
    /** Sentry `cron` tag, e.g. `lead_digest`. Alerts key on this, not the message. */
    tag: string;
    /** How often the job repeats. */
    intervalMs: number;
    /**
     * Delay before the FIRST run. Never 0 — jobs touch the DB and Redis, which
     * need a moment to settle after boot, and a heavy first run would compete
     * with the readiness probe.
     */
    initialDelayMs: number;
    run: () => Promise<unknown>;
    /** Server logger's error method, e.g. `server.log.error.bind(server.log)`. */
    logError: (err: unknown, msg: string) => void;
}

export function scheduleRecurringJob(opts: RecurringJobOptions): void {
    const fire = (phase: 'Scheduled' | 'Initial') => {
        opts.run().catch((err: unknown) => {
            const msg = `${opts.label} ${phase} run failed`;
            opts.logError(err, msg);
            captureError(err, msg, { tags: { cron: opts.tag }, level: 'error' });
        });
    };

    setInterval(() => fire('Scheduled'), opts.intervalMs);
    setTimeout(() => fire('Initial'), opts.initialDelayMs);
}
