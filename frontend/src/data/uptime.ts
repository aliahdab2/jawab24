/**
 * Measured availability, quoted on /trust.
 *
 * WHY A CONSTANT AND NOT A LIVE FETCH: the figure is bounded by an explicit
 * window, so it stays true forever instead of drifting — the same choice the
 * landing-page fleet numbers make. A live endpoint would also have to expose
 * our monitoring publicly, and the credibility here comes from the THIRD-PARTY
 * status page being the citation, not from our own API asserting a number.
 *
 * SOURCE: UptimeRobot account, `get-monitor-stats` over a 90-day range,
 * read 2026-08-19. `overallUptime` came back as 0.999895061728395 across two
 * monitors (jawab24.com and jawab24.com/api/health), both HTTP, 300s interval.
 *
 * TO REFRESH: re-read the 90-day stats, update every field below including
 * MEASURED_AT, and mirror the percentage into public/llms.txt and
 * public/llms-full.txt — validate-llms.js pins those three to agree.
 */
export const UPTIME_STATS = {
    /** Rounded for display. Measured value was 99.9895%. */
    percent: '99.99',
    windowDays: 90,
    /** ISO dates bounding the measurement window. */
    windowStart: '2026-05-21',
    windowEnd: '2026-08-19',
    incidents: 3,
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
