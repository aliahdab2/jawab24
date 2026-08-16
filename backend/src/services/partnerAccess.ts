import { db } from '../db';
import { partners } from '../db/schema';
import { and, eq, isNull, or, type SQL } from 'drizzle-orm';

/**
 * Partner identity anchors — the SINGLE definition of "which `partners` row
 * belongs to this login", plus the read-only predicate the LOGIN path asks.
 *
 * Deliberately its own module rather than a method on `partnerPortalService`:
 * that service imports `adminUsersService` for the merchant-detail projection,
 * which pulls `workspaceSettings` → `lib/redis`, and Redis connects at module
 * load. Importing it from the auth controller put that whole graph on every
 * login — including a Redis connection attempt during route setup. Keeping the
 * check here means the login path imports `db` + the `partners` table, nothing
 * more. (Caught by two auth suites failing at import with
 * `Cannot read properties of undefined (reading 'host')`.)
 *
 * The dependency arrow therefore only ever points THIS way: `partnerPortal`
 * imports these builders, never the reverse. Adding an import here that reaches
 * `adminUsersService` / `lib/redis` re-creates the login-path regression above.
 */

/**
 * Anchor 1 — the persisted link. Once a partner has opened the portal, this is
 * the only anchor that matters.
 */
export function partnerBoundToUser(userId: string): SQL | undefined {
    return and(eq(partners.isActive, true), eq(partners.userId, userId));
}

/**
 * Anchor 2 — the lazy-bind anchor, restricted to a row NOBODY has claimed.
 *
 * ⛔ EMAIL IS NOT AN ANCHOR — see the rationale on
 * `partnerPortal.resolvePartnerForUser`. `users.phone` is unique and provable
 * by OTP; `users.email` is neither.
 *
 * The `user_id IS NULL` restriction is what keeps the two callers honest with
 * each other: the claim path refuses to re-bind a row that belongs to another
 * login, so a predicate WITHOUT it would render a menu entry for a portal that
 * answers 403 — a dead link that reads as a broken feature, and a free hint
 * that some other account holds that row.
 */
export function partnerClaimableByPhone(phone: string): SQL | undefined {
    return and(
        eq(partners.isActive, true),
        eq(partners.phone, phone),
        isNull(partners.userId),
    );
}

/**
 * The one normalisation both callers must agree on. A stored phone is E.164;
 * a whitespace-only `users.phone` is not an anchor at all and must never widen
 * the query to "any partner row with a blank phone".
 */
export function partnerPhoneAnchor(phone?: string | null): string | null {
    return phone?.trim() || null;
}

/**
 * Answers ONLY "should the Partner nav entry render?". Never an authorization
 * decision: `/partner/*` re-resolves the partners table on every request.
 *
 * Read-only by construction, and that is the point. The portal's own
 * `resolvePartnerForUser` CLAIMS an unbound row for the caller — correct when
 * someone opens the portal, catastrophic here, where every user in the product
 * passes through at login: it would hand permanent possession of a rep's
 * merchant book to whoever signed in first, with no portal request ever made.
 *
 * It matches on the same two anchor expressions the claim path uses — shared
 * as functions, not re-typed, so the entry cannot drift out of agreement with
 * the access decision it advertises.
 */
export async function isPartnerUser(user: { id: string; phone?: string | null }): Promise<boolean> {
    const phone = partnerPhoneAnchor(user.phone);

    const [row] = await db
        .select({ id: partners.id })
        .from(partners)
        .where(phone
            ? or(partnerBoundToUser(user.id), partnerClaimableByPhone(phone))
            : partnerBoundToUser(user.id))
        .limit(1);

    return !!row;
}
