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
