/**
 * Escape LIKE/ILIKE wildcards in a user-supplied search term so `%`, `_` and
 * the escape character itself match literally. Drizzle's ilike() passes the
 * term as a plain bind parameter (no escaping of its own), and Postgres'
 * default LIKE escape character is backslash — so this is the only wildcard
 * guard between the search box and the query.
 */
export function escapeLike(term: string): string {
    return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}
