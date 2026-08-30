import { and, eq, or } from 'drizzle-orm';
import crypto from 'crypto';
import { db } from '../db';
import { trialGrants } from '../db/schema';
import { config } from '../config';
import { captureError } from '../utils/sentryHelpers';

/**
 * Anti free-trial-abuse for the per-ACCOUNT benefit: the one-time 14-day Starter
 * trial every brand-new account receives. Sibling to channelTrialService, which
 * guards the per-CHANNEL trial.
 *
 * Why this exists: account deletion is a GDPR-honoring hard delete
 * (services/auth.ts deleteUser) that removes the users row plus its subscription
 * and usage rows. The unique constraints on users.phone / users.facebookId only
 * block LIVE duplicates, so once the row is gone the same person can re-sign-up
 * and the signup path treats them as brand-new — minting another fresh trial +
 * monthly quota every cycle. This ledger records, per signup identity, that the
 * identity already consumed its trial, and the row survives the delete
 * (trial_grants.firstUserId SET NULL). subscriptions.createSubscription consults
 * hasConsumedTrial() and, when true, issues a 'canceled' subscription (no free
 * trial) instead of a fresh 30 days. See the `trial_grants` table comment in
 * db/schema.ts.
 *
 * Identities are stored as keyed HMAC hashes only — the raw phone / Facebook id
 * is PII we just deleted, and equality matching is all this ledger ever needs.
 *
 * Scope/known gap: a returnee who switches signup METHOD (phone-trial farmer who
 * comes back via Facebook, or vice-versa) presents a different identity and is not
 * caught — linking phone ↔ Facebook requires identity data we don't have at
 * signup. Same-identity re-registration (the observed abuse) is covered.
 */

export type TrialIdentityType = 'phone' | 'facebook';

export interface TrialIdentity {
    type: TrialIdentityType;
    value: string;
}

/**
 * Keyed, domain-separated HMAC-SHA256 of a signup identity.
 *
 * Keyed (not a bare SHA-256) because the phone-number keyspace is small enough to
 * brute-force a plain hash with a rainbow table — keying makes the stored value
 * non-reversible without the secret. Keyed by JWT_SECRET (already required in
 * prod and loaded here). Rotating JWT_SECRET makes existing hashes unmatchable,
 * degrading this guard back to "fresh trial on return" until the table refills —
 * acceptable for a best-effort abuse heuristic, and JWT_SECRET rotation is rare.
 * The `trial-ledger:v1:` domain prefix isolates this HMAC use from token signing
 * so the two can never collide.
 */
function hashIdentity(type: TrialIdentityType, value: string): string {
    return crypto
        .createHmac('sha256', config.jwt.secret)
        .update(`trial-ledger:v1:${type}:${value.trim().toLowerCase()}`)
        .digest('hex');
}

export const trialLedgerService = {
    /**
     * Build the ledger identities for a user row. A signup always carries at least
     * one of phone / facebookId; we key on whichever are present. The seeded demo
     * account is exempt — it is re-seeded directly and must keep a live trial for
     * display, so returning [] makes every ledger op a no-op for it.
     */
    identitiesForUser(user: { phone?: string | null; facebookId?: string | null }): TrialIdentity[] {
        if (user.facebookId && user.facebookId === config.demo.userFacebookId) return [];
        const identities: TrialIdentity[] = [];
        if (user.phone) identities.push({ type: 'phone', value: user.phone });
        if (user.facebookId) identities.push({ type: 'facebook', value: user.facebookId });
        return identities;
    },

    /**
     * Has any of these identities already consumed its free trial in a prior
     * (possibly since-deleted) account?
     */
    async hasConsumedTrial(identities: TrialIdentity[]): Promise<boolean> {
        if (identities.length === 0) return false;

        const rows = await db
            .select({ id: trialGrants.id })
            .from(trialGrants)
            .where(or(...identities.map(i => and(
                eq(trialGrants.identityType, i.type),
                eq(trialGrants.identityHash, hashIdentity(i.type, i.value)),
            ))))
            .limit(1);

        return rows.length > 0;
    },

    /**
     * Claim the free trial for these identities. First writer wins — a row already
     * present (same identity) is left untouched, preserving the original
     * firstTrialedAt.
     *
     * Best-effort: this runs AFTER the subscription has been created, so a write
     * failure must not break signup. A missed claim self-heals — the identity is
     * simply re-checked (and re-claimable) on the next signup. Errors are reported,
     * never silently swallowed.
     */
    async record(identities: TrialIdentity[], userId: string): Promise<void> {
        if (identities.length === 0) return;
        try {
            await db
                .insert(trialGrants)
                .values(identities.map(i => ({
                    identityType: i.type,
                    identityHash: hashIdentity(i.type, i.value),
                    firstUserId: userId,
                })))
                .onConflictDoNothing({ target: [trialGrants.identityType, trialGrants.identityHash] });
        } catch (err) {
            captureError(err, 'trialLedger.record failed', {
                tags: { service: 'trialLedger', action: 'record' },
                extra: { userId },
            });
        }
    },
};
