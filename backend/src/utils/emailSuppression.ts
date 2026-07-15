import { eq } from 'drizzle-orm';
import { db } from '../db';
import { emailUnsubscribes } from '../db/schema';

/**
 * Global email suppression check against the `email_unsubscribes` list.
 *
 * MARKETING / lifecycle emails (e.g. the trial-ended win-back) MUST gate on this
 * before sending. Transactional emails (receipts, invites, password resets)
 * deliberately do not — they're a direct response to a user action.
 *
 * Addresses are stored lowercased (the unsubscribe route lowercases on insert),
 * so we normalize before comparing. An empty/blank address is treated as
 * suppressed — there's nothing safe to send to.
 *
 * This is the single shared gate; previously only the admin waitlist broadcast
 * consulted the suppression list (in-memory Set). New senders should call this.
 */
export async function isEmailSuppressed(email: string | null | undefined): Promise<boolean> {
    const normalized = (email ?? '').trim().toLowerCase();
    if (!normalized) return true;
    const rows = await db
        .select({ email: emailUnsubscribes.email })
        .from(emailUnsubscribes)
        .where(eq(emailUnsubscribes.email, normalized))
        .limit(1);
    return rows.length > 0;
}
