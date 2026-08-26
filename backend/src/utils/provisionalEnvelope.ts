/**
 * Tolerant field readers for [provisional] third-party envelopes — payload
 * shapes inferred from docs but never round-tripped live (the Zid and Salla
 * billing rails). Each probes plausible spellings without guessing at
 * semantics; what a field MEANS stays in the rail that reads it.
 *
 * Shared between services/zidBilling.ts and services/sallaBilling.ts (Rule
 * 10.8 — these were byte-identical private copies before the Salla rail
 * landed).
 */

/** Read the first present key from a tolerant envelope [provisional]. */
export function pick(source: Record<string, unknown>, ...keys: string[]): unknown {
    for (const key of keys) {
        const value = source[key];
        if (value !== undefined && value !== null && value !== '') return value;
    }
    return undefined;
}

/** Stringify a scalar (string | number) field; null for anything else. */
export function asString(value: unknown): string | null {
    if (value === undefined || value === null) return null;
    if (typeof value === 'string' || typeof value === 'number') return String(value);
    return null;
}

/** Parse an ISO-ish date string; null when absent or unparseable. */
export function parseDate(value: string | null): Date | null {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}
