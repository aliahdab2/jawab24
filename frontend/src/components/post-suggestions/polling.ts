/**
 * Timing for the «بوست اليوم» pending poll — ONE home, because two surfaces
 * watch the same row (the sheet while the merchant waits, the dashboard card
 * once they close it) and a disagreement between them would show the post
 * appearing in one place before the other.
 *
 * Generation runs ~35s in a worker. The request itself returns immediately with
 * a `pending` row, so these numbers govern only how often we ask whether it has
 * finished — not how long the merchant waits.
 */

/** How often to re-read today's row while it is pending. */
export const POST_SUGGESTION_POLL_MS = 3_000;

/**
 * When to stop asking and say so.
 *
 * Not an error: the worker owns the row and always drives it to `ready` or
 * `failed`, so a row still pending here means slow, not lost. The merchant is
 * told it is still running rather than shown a failure that did not happen.
 */
export const POST_SUGGESTION_POLL_TIMEOUT_MS = 120_000;
