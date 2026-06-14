/**
 * IANA timezone helpers, shared so the "is this a usable timeZone?" check has a
 * single definition. Used by the settings schema (input validation) and the
 * ai-worker prompt builder (today's-date computation).
 */

/** True when `tz` is a valid IANA timezone name that Intl can format with. */
export function isValidTimezone(tz: string | undefined | null): boolean {
    if (!tz) return false;
    try {
        // Throws RangeError for invalid IANA names — probe before trusting.
        new Intl.DateTimeFormat('en-US', { timeZone: tz });
        return true;
    } catch {
        return false;
    }
}

/** Return `tz` if it is a valid IANA timezone, otherwise fall back to UTC. */
export function safeTimezone(tz?: string | null): string {
    return isValidTimezone(tz) ? (tz as string) : 'UTC';
}
