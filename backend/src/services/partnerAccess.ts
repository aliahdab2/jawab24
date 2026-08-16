import { db } from '../db';
import { partners } from '../db/schema';
import { and, eq, isNull, or } from 'drizzle-orm';

/**
 * "Is this login a partner?" — the one partner question the LOGIN path asks.
 *
 * Deliberately its own module rather than a method on `partnerPortalService`:
 * that service imports `adminUsersService` for the merchant-detail projection,
 * which pulls `workspaceSettings` → `lib/redis`, and Redis connects at module
 * load. Importing it from the auth controller put that whole graph on every
 * login — including a Redis connection attempt during route setup. Keeping the
 * check here means the login path imports `db` + the `partners` table, nothing
 * more. (Caught by two auth suites failing at import with
 * `Cannot read properties of undefined (reading 'host')`.)
 */

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
 * The predicate mirrors that function's anchors EXACTLY — `partners.user_id`
 * once bound, otherwise `users.phone` on a row nobody has claimed, never email
 * (see the anchor rationale in `partnerPortal.resolvePartnerForUser`; email is
 * unverified and non-unique in this product). Matching more loosely than the
 * claim path would put a menu entry in front of a user the portal answers 403
 * to; matching on email would re-open the hijack that rationale describes.
 */
export async function isPartnerUser(user: { id: string; phone?: string | null }): Promise<boolean> {
    const phone = user.phone?.trim() || null;

    const [row] = await db
        .select({ id: partners.id })
        .from(partners)
        .where(and(
            eq(partners.isActive, true),
            phone
                ? or(
                    eq(partners.userId, user.id),
                    and(eq(partners.phone, phone), isNull(partners.userId)),
                )
                : eq(partners.userId, user.id),
        ))
        .limit(1);

    return !!row;
}
