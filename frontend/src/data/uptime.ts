/**
 * Measured availability, quoted on /trust.
 *
 * WHY A CONSTANT AND NOT A LIVE FETCH: the figure is bounded by an explicit
 * window, so it stays true forever instead of drifting — the same choice the
 * landing-page fleet numbers make. A live endpoint would also have to expose
 * our monitoring publicly, and the credibility here comes from the THIRD-PARTY
 * status page being the citation, not from our own API asserting a number.
 *
 * SOURCE: UptimeRobot account, read 2026-08-19. Two monitors, both HTTP with a
 * 300s interval, both created 2025-12-01 so both cover the full window.
 *
 * ⛔ WE QUOTE THE WORSE MONITOR, NOT THE ACCOUNT AVERAGE. UptimeRobot's
 * account-wide `overallUptime` was 0.999895 (99.99%), but all three incidents
 * were on /api/health while jawab24.com — a largely static marketing page —
 * had none. Publishing the blend would let the page that never goes down
 * flatter the API that actually answers customers, and anyone with the public
 * status page open could compute the real figure and call it out. So:
 *   jawab24.com          0 incidents          100%
 *   jawab24.com/api/health   3 × 502, 1632s   99.979%  ← published
 * 1632s over 90 days (7,776,000s) = 99.9790%. Incident durations 5m7s + 5m5s
 * + 17m sum to exactly the 1632s the stats endpoint reports, so the figure is
 * confirmed from two directions.
 *
 * TO REFRESH: re-read the 90-day stats AND the incident list, recompute from
 * the WORST monitor, update every field below including measuredAt, and mirror
 * the percentage into public/llms.txt and public/llms-full.txt —
 * validate-llms.js pins those two to agree, and
 * src/__tests__/pages/trustEvidence.test.ts pins them to this constant.
 */
export const UPTIME_STATS = {
    /** Worst monitor over the window, rounded down from 99.9790%. */
    percent: '99.97',
    windowDays: 90,
    /** ISO dates bounding the measurement window. */
    windowStart: '2026-05-21',
    windowEnd: '2026-08-19',
    incidents: 3,
    /** Total recorded downtime in the window, seconds. All of it on /api/health. */
    downtimeSeconds: 1632,
    /** Monitors covered: the marketing site and the API health endpoint. */
    monitors: 2,
    /** Seconds between checks, per monitor. */
    checkIntervalSeconds: 300,
    provider: 'UptimeRobot',
    statusPageUrl: 'https://stats.uptimerobot.com/ijNBtFf9SC',
    measuredAt: '2026-08-19',
} as const;

/** Minutes between checks — what the page actually shows a reader. */
export const CHECK_INTERVAL_MINUTES = UPTIME_STATS.checkIntervalSeconds / 60;

/** Total downtime in whole minutes — a concrete claim a reader can check
 *  against the status page, which a percentage alone hides. */
export const DOWNTIME_MINUTES = Math.round(UPTIME_STATS.downtimeSeconds / 60);
