/**
 * Jittered reply delay so replies don't always land at exactly the configured
 * time — a constant delay (e.g. always 3.000s) is itself a bot tell.
 *
 * The configured time is treated as a FLOOR: we never reply faster than the
 * merchant asked, only add up to 50% extra random time on top. So a 3s setting
 * yields a wait in [3.0s, 4.5s). Matches the merchant-facing copy in
 * ReplyDelayCard ("between your set time and 1.5× it").
 *
 * Returns 0 for 0 so "Instant" stays instant.
 *
 * @param seconds merchant's configured replyDelay (already validated 0–300)
 * @returns delay in milliseconds, randomized in [1×, 1.5×) of the configured time
 */
export function computeHumanDelayMs(seconds: number): number {
    if (seconds <= 0) return 0;
    const base = seconds * 1000;
    const factor = 1 + Math.random() * 0.5; // [1.0, 1.5)
    return Math.round(base * factor);
}
