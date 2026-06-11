/**
 * Pagination query parsing — shared across paginated list endpoints.
 *
 * Centralizes the page/limit clamping that was previously copy-pasted inline
 * in several admin endpoints (users/all, waitlist, lead-digest history). Keeps
 * the exact clamping semantics those endpoints relied on:
 *   - page:  floor 1 (any non-positive / NaN value → 1)
 *   - limit: clamped to [1, maxLimit], default `defaultLimit` on NaN
 *   - offset: derived as (page - 1) * limit
 */
export interface ParsedPagination {
    pageNum: number;
    limitNum: number;
    offset: number;
}

/**
 * Parse raw page/limit query strings into clamped numbers + offset.
 *
 * @param page  raw `page` query string (e.g. request.query.page)
 * @param limit raw `limit` query string
 * @param defaultLimit limit to use when `limit` is missing/NaN (default 20)
 * @param maxLimit upper clamp for `limit` (default 100)
 */
export function parsePaginationQuery(
    page?: string,
    limit?: string,
    defaultLimit = 20,
    maxLimit = 100,
): ParsedPagination {
    const pageNum = Math.max(1, parseInt(page ?? '1', 10) || 1);
    const limitNum = Math.min(maxLimit, Math.max(1, parseInt(limit ?? String(defaultLimit), 10) || defaultLimit));
    const offset = (pageNum - 1) * limitNum;
    return { pageNum, limitNum, offset };
}
