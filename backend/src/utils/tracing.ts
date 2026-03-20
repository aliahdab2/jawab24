/**
 * Traced external call helper.
 *
 * Combines Sentry span (distributed tracing) + prom-client histogram
 * (Prometheus latency metrics) in one call. Use this in service files
 * instead of raw Sentry.startSpan.
 *
 * Separated from metrics.ts so Sentry tracing and Prometheus metrics
 * can be toggled independently.
 */
import * as Sentry from '@sentry/node';
import { externalApiDuration } from '../lib/metrics';

export function tracedExternalCall<T>(
    service: string,
    method: string,
    fn: () => Promise<T>,
): Promise<T> {
    const end = externalApiDuration.startTimer({ service, method, status: 'success' });
    return Sentry.startSpan(
        { name: `${service}.${method}`, op: 'http.client' },
        () => fn().then(
            (result) => { end({ status: 'success' }); return result; },
            (error) => { end({ status: 'error' }); throw error; },
        ),
    );
}
