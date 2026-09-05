/**
 * "Who do we email, and in which language?" — one answer for every per-user
 * merchant email.
 *
 * The lookup (users.email + settings.dashboard_language, keyed by user id) had
 * been hand-copied per call site: `pageTokenRecovery` carries its own and the
 * AI-usage threshold email would have been the second, with `pageAutoPause`'s
 * page-joined variant a near-third. Copies drift — `pageAutoPause` learned the
 * "release the dedup claim unless the email actually DELIVERED" rule and
 * `pageTokenRecovery` did not inherit it for months — so the shape lives here
 * once (Rule 10.8).
 *
 * A user with no address on file resolves to `null`, never to a row with an
 * empty `to`: the caller must be able to distinguish "nothing was sent because
 * there is nowhere to send it" from a failed send.
 */
import { and, eq, isNotNull } from 'drizzle-orm';
import { db } from '../db';
import { users, settings } from '../db/schema';
import { resolveLocale, type Locale } from '../utils/i18n';

export interface EmailRecipient {
    email: string;
    /** Greeting name — falls back to the address' local part, never empty. */
    name: string;
    /** Dashboard language, resolved to a supported locale (defaults to `ar`). */
    lang: Locale;
}

/** Resolve a user's email recipient, or `null` when no address is on file. */
export async function getEmailRecipient(userId: string): Promise<EmailRecipient | null> {
    const [row] = await db
        .select({
            email: users.email,
            name: users.name,
            dashboardLanguage: settings.dashboardLanguage,
        })
        .from(users)
        .leftJoin(settings, eq(settings.userId, users.id))
        .where(and(eq(users.id, userId), isNotNull(users.email)))
        .limit(1);

    if (!row?.email) return null;

    return {
        email: row.email,
        // Same fallback the lifecycle sweeps use, so the greeting reads the same
        // whichever channel reached the merchant.
        name: row.name || row.email.split('@')[0],
        lang: resolveLocale(row.dashboardLanguage),
    };
}
