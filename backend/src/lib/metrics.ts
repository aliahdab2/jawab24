/**
 * Application Metrics (prom-client)
 *
 * Exposes Prometheus-compatible metrics for Grafana dashboards.
 * Includes default Node.js process metrics (CPU, memory, event loop, GC)
 * plus custom application counters, histograms, and gauges.
 *
 * Redis command tracing is NOT here — @sentry/node v10+ auto-instruments
 * ioredis with Sentry spans. No need for a separate prom-client histogram.
 */
import client, { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

// Use a dedicated registry so default metrics don't leak across test runs
export const registry = new Registry();

// Default Node.js metrics: CPU, memory, event loop lag, active handles, GC
collectDefaultMetrics({ register: registry, prefix: 'jawab24_' });

// ------------------------------------------------------------------
// Pipeline outcome counters
// Redis counters in pipelineMetrics.ts still work for the /health/pipeline-metrics
// JSON endpoint. These prom-client counters provide the Prometheus format.
// ------------------------------------------------------------------
export const pipelineOutcomeCounter = new Counter({
    name: 'jawab24_pipeline_total',
    help: 'Total pipeline outcomes by pipeline and outcome',
    labelNames: ['pipeline', 'outcome'] as const,
    registers: [registry],
});

// ------------------------------------------------------------------
// External API latency histograms
// ------------------------------------------------------------------
export const externalApiDuration = new Histogram({
    name: 'jawab24_external_api_duration_seconds',
    help: 'External API call latency in seconds',
    labelNames: ['service', 'method', 'status'] as const,
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
    registers: [registry],
});

/**
 * Vision (image-understanding) call latency, with its own buckets.
 *
 * Deliberately separate from `externalApiDuration` rather than reusing it with
 * `service='openai_vision'`: that histogram jumps 10 → 30 seconds, and every
 * interesting vision value lives inside that gap (measured over 30 days of
 * production: p50 7.8s, p90 12.8s, p99 19.7s). Sharing it would collapse the
 * whole distribution into one bucket and `histogram_quantile` could not tell
 * a healthy day from the day we lost 8 of 10 images.
 *
 * The gap this closes: `ai_usage_log` stores tokens and cost but no duration,
 * so the 2026-08-11 question "is the 20s vision timeout too tight?" could only
 * be answered from `messages.updated_at`, a proxy polluted by every later write
 * to the row. It was — the budget sat exactly on the p99.
 *
 * `outcome` is low-cardinality by construction (five values), so it is safe as
 * a Prometheus label. Timeouts are recorded too: a latency distribution built
 * only from successes is the survivorship bias that hid the problem.
 */
export const visionDuration = new Histogram({
    name: 'jawab24_vision_duration_seconds',
    help: 'Image-understanding vision call latency in seconds, by outcome',
    labelNames: ['outcome'] as const,
    buckets: [1, 2.5, 5, 7.5, 10, 12.5, 15, 20, 25, 30, 35, 45],
    registers: [registry],
});

// ------------------------------------------------------------------
// Uptime gauge
// ------------------------------------------------------------------
const startTime = Date.now();
export const uptimeGauge = new Gauge({
    name: 'jawab24_uptime_seconds',
    help: 'Backend uptime in seconds',
    registers: [registry],
    collect() {
        this.set(Math.floor((Date.now() - startTime) / 1000));
    },
});

export { client, registry as metricsRegistry };
