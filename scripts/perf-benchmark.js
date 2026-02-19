#!/usr/bin/env node
/**
 * Performance Benchmark Script
 *
 * Runs load tests against the backend API to detect latency regressions.
 * Uses autocannon — no separate install required (via npx).
 *
 * Usage:
 *   node scripts/perf-benchmark.js [base-url]
 *
 * Examples:
 *   node scripts/perf-benchmark.js                         # localhost:3000
 *   node scripts/perf-benchmark.js http://localhost:3000   # explicit
 *   node scripts/perf-benchmark.js https://jawab24.com     # production
 *
 * Exit codes:
 *   0  All thresholds passed
 *   1  One or more thresholds exceeded (p95 too high or error rate too high)
 */

'use strict';

const autocannon = require('autocannon');

const BASE_URL = process.argv[2] || 'http://localhost:3000';

// Thresholds — these are the gates. Adjust if the server hardware changes.
const THRESHOLDS = {
  p95MaxMs: 500,      // p95 latency must be under 500ms
  errorRateMax: 0.01, // error rate must be under 1%
};

// Endpoints to benchmark (only those that work without a real DB connection)
const BENCHMARKS = [
  {
    name: 'Health Check',
    url: `${BASE_URL}/health`,
    connections: 50,
    duration: 10,
    description: 'Baseline throughput — no DB needed',
  },
  {
    name: 'API Health',
    url: `${BASE_URL}/api/health`,
    connections: 50,
    duration: 10,
    description: 'API router health — no DB needed',
  },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatMs(ms) {
  return `${Math.round(ms)}ms`;
}

function formatRps(rps) {
  return `${Math.round(rps).toLocaleString()} req/s`;
}

function runBenchmark(opts) {
  return new Promise((resolve) => {
    const instance = autocannon({
      url: opts.url,
      connections: opts.connections,
      duration: opts.duration,
      headers: { 'Accept': 'application/json' },
    }, (err, result) => {
      if (err) {
        resolve({ error: err.message });
      } else {
        resolve(result);
      }
    });

    // Print live progress
    autocannon.track(instance, { renderProgressBar: true });
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Performance Benchmark');
  console.log(`  Target: ${BASE_URL}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  const results = [];
  let allPassed = true;

  for (const bench of BENCHMARKS) {
    console.log(`\n▶ ${bench.name}`);
    console.log(`  ${bench.description}`);
    console.log(`  ${bench.connections} connections × ${bench.duration}s`);
    console.log('');

    const result = await runBenchmark(bench);

    if (result.error) {
      console.log(`  ❌ Failed: ${result.error}`);
      results.push({ name: bench.name, passed: false, error: result.error });
      allPassed = false;
      continue;
    }

    const p95 = result.latency.p97_5 ?? result.latency.p99;  // autocannon uses p97_5 for ~p95
    const totalRequests = result.requests.total;
    const errors = result.errors + result.timeouts;
    const errorRate = totalRequests > 0 ? errors / totalRequests : 0;
    const rps = result.requests.average;

    const p95Pass = p95 <= THRESHOLDS.p95MaxMs;
    const errorPass = errorRate <= THRESHOLDS.errorRateMax;
    const passed = p95Pass && errorPass;

    if (!passed) allPassed = false;

    const status = passed ? '✅' : '❌';
    console.log(`\n  ${status} ${bench.name}`);
    console.log(`     p95 latency : ${formatMs(p95)}   (threshold: <${THRESHOLDS.p95MaxMs}ms)  ${p95Pass ? '✅' : '❌'}`);
    console.log(`     error rate  : ${(errorRate * 100).toFixed(2)}%     (threshold: <${THRESHOLDS.errorRateMax * 100}%)  ${errorPass ? '✅' : '❌'}`);
    console.log(`     throughput  : ${formatRps(rps)}`);
    console.log(`     total req   : ${totalRequests.toLocaleString()}`);

    results.push({ name: bench.name, passed, p95, errorRate, rps });
  }

  // ── Summary ─────────────────────────────────────────────────────────────

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Summary');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  for (const r of results) {
    if (r.error) {
      console.log(`  ❌ ${r.name}: ERROR — ${r.error}`);
    } else {
      console.log(`  ${r.passed ? '✅' : '❌'} ${r.name}: p95=${formatMs(r.p95)}, errors=${(r.errorRate * 100).toFixed(2)}%, ${formatRps(r.rps)}`);
    }
  }

  console.log('');

  if (allPassed) {
    console.log('  ✅ ALL BENCHMARKS PASSED');
  } else {
    console.log('  ❌ BENCHMARK THRESHOLDS EXCEEDED');
    console.log('     Investigate latency regressions before deploying.');
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error('Benchmark script error:', err);
  process.exit(1);
});
