/**
 * Shared query-string parsers used across controllers.
 * HTTP query params arrive as strings; these helpers coerce them to typed values.
 */

/** Parse the common boolean inbox filters shared by the messages and comments controllers. */
export function parseInboxFilters(query: {
    replied?: string;
    resolved?: string;
    needsAttention?: string;
    actionRequired?: string;
}): {
    replied?: boolean;
    resolved?: boolean;
    needsAttention?: boolean;
    actionRequired?: boolean;
} {
    const opts: {
        replied?: boolean;
        resolved?: boolean;
        needsAttention?: boolean;
        actionRequired?: boolean;
    } = {};

    if (query.replied       !== undefined) opts.replied       = query.replied       === 'true';
    if (query.resolved      !== undefined) opts.resolved      = query.resolved      === 'true';
    if (query.needsAttention !== undefined) opts.needsAttention = query.needsAttention === 'true';
    if (query.actionRequired !== undefined) opts.actionRequired = query.actionRequired === 'true';

    return opts;
}

/** Parse and clamp a `limit` query param (string → number, 1–100, default 50). */
export function parseLimit(raw: string | undefined, defaultVal = 50): number {
    if (!raw) return defaultVal;
    const n = parseInt(raw, 10);
    return isNaN(n) ? defaultVal : Math.min(Math.max(n, 1), 100);
}
