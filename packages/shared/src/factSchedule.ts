/**
 * When a dated fact row is visible to the AI.
 *
 * OWNER RULING 2026-07-31 — «تاريخ النهاية لا يجب أن نعتمد عليه» (D-057):
 * the START date owns visibility. A dated row leaves the prompt the day AFTER
 * it starts, because an announced cohort that has already begun is stale
 * regardless of what its end date claims. `endsAt` is descriptive — it is
 * printed for the customer and it only gates rows that carry no start date.
 *
 * Behaviour on the rows that exist today is UNCHANGED: every dated row written
 * by the one-date-field era has `startsAt === endsAt`, for which the old rule
 * (`endsAt >= today`) and this one agree exactly. `factSchedule.test.ts` pins
 * that equivalence so the claim is a running test, not a note in a PR body.
 *
 * ── THREE consumers must agree on this rule ──────────────────────────────────
 *   1. the backend renderer          → imports this function
 *   2. the merchant editor (frontend) → imports this function
 *   3. the SQL WHERE clause in `factCollectionsService.buildFactCollectionsContext`
 *
 * (3) cannot import it — it has to be expressed in SQL — so it is pinned by a
 * contract test that runs the query and this predicate over the same 16-row
 * date matrix and asserts identical row sets:
 * `backend/test/integration/factCollections.test.ts` → "isRowLive — SQL and TS agree".
 * If you change the rule here, that test fails until the SQL matches. Do not
 * add a fourth hand-written copy.
 */

/** The two columns that decide a row's visibility. Structurally typed so both
 *  the DB row and the frontend DTO satisfy it without a shared row type. */
export interface FactRowSchedule {
    startsAt: string | null;
    endsAt: string | null;
}

/**
 * @param row      the row's `startsAt` / `endsAt`, each `'YYYY-MM-DD'` or null.
 * @param todayIso today as `'YYYY-MM-DD'` — INJECTED, never read from the clock
 *                 here, so rendering stays pure and the caller owns the timezone
 *                 (the merchant's IANA zone, not the server's UTC or the
 *                 browser's local — see `resolveFactToday`).
 *
 * Both columns are real PG `date`s surfaced as `'YYYY-MM-DD'`, so the
 * lexicographic string comparison is also the chronological one.
 */
export function isRowLive(row: FactRowSchedule, todayIso: string): boolean {
    // A start date, once passed, retires the row — the end date is not consulted.
    if (row.startsAt) return row.startsAt >= todayIso;
    // Undated rows live forever; end-dated ones retire the day after they end.
    return !row.endsAt || row.endsAt >= todayIso;
}
