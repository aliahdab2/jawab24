import { db } from '../db';
import { refreshTokens } from '../db/schema';
import { eq, and, isNull, isNotNull } from 'drizzle-orm';
import crypto from 'crypto';
import { authService } from './auth';
import { sha256Hex } from '../utils/hash';
import type { User, Logger } from '../types';
import { noopLogger } from '../types';

const REFRESH_TOKEN_EXPIRY_MS = 60 * 24 * 60 * 60 * 1000; // 60 days — B2B SaaS standard (Shopify, Salla, Slack)

// Reuse-grace window after rotation (Auth0 "reuse interval" model). Strict
// single-use rotation force-logs-out real users: two tabs sharing one cookie
// jar race a refresh, the loser presents the just-revoked predecessor, gets
// 401, and the frontend kills the whole session (nginx-verified prod incident,
// 2026-07-30 — repeated login walls on mobile). Within this window a
// rotation-revoked token from a LIVE family is accepted and minted a fresh
// successor. Terminally-revoked families (logout, reuse detection) never get
// grace — that is what keeps the window from resurrecting a killed session.
const ROTATION_GRACE_MS = 60 * 1000;

export class RefreshTokenService {
    /**
     * Create a new Refresh Token (Level 2 Security)
     *
     * `familyId` groups every token descended from one login. Omit it for a
     * fresh login (a new family is started); pass the current family when
     * rotating so the whole lineage stays revocable in one statement.
     */
    async createRefreshToken(userId: string, familyId?: string): Promise<string> {
        // 1. Generate high-entropy random token
        const rawToken = crypto.randomBytes(40).toString('hex');

        // 2. Hash it before storage (Security Best Practice)
        const tokenHash = sha256Hex(rawToken);

        // 3. Store in DB
        await db.insert(refreshTokens).values({
            userId,
            tokenHash,
            familyId: familyId ?? crypto.randomUUID(),
            expiresAt: new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS),
        });

        // 4. Return RAW token to user (we never see it again)
        return rawToken;
    }

    /**
     * Verify and rotate refresh token
     * Returns the user and a NEW refresh token (Rotation)
     *
     * A token already rotated away is still accepted within ROTATION_GRACE_MS
     * of its revocation (concurrent-tab race, lost Set-Cookie on a page that
     * navigated away mid-refresh) and is minted its own fresh successor —
     * but ONLY while its family is alive. Beyond the window, reuse is treated
     * as a stolen-token replay and the whole family is revoked.
     */
    async rotateRefreshToken(rawToken: string, logger: Logger = noopLogger): Promise<{ user: User; newRefreshToken: string } | null> {
        const tokenHash = sha256Hex(rawToken);

        // 1. Find token in DB
        const [tokenRecord] = await db
            .select()
            .from(refreshTokens)
            .where(eq(refreshTokens.tokenHash, tokenHash));

        if (!tokenRecord) {
            return null;
        }

        // 2. Check expiry (applies to the grace path too)
        if (tokenRecord.expiresAt < new Date()) {
            return null;
        }

        // Rows predating family_id adopt their own id as the family root, so a
        // legacy token still gets a coherent (single-member) family to revoke.
        const familyId = tokenRecord.familyId ?? tokenRecord.id;

        // 3. Revoked token: reuse is allowed ONLY when this was a rotation
        // (replacedByTokenHash present), inside the grace window, and the
        // family has not since been terminated.
        if (tokenRecord.revokedAt) {
            if (!tokenRecord.replacedByTokenHash) {
                // Terminal revocation (logout / reuse detection) — never resurrect.
                return null;
            }

            const withinGrace = Date.now() - tokenRecord.revokedAt.getTime() <= ROTATION_GRACE_MS;
            if (!withinGrace) {
                // Reuse detection (OAuth 2.0 Security BCP, RFC 9700 §4.14.2):
                // a rotated token replayed long after rotation is treated as a
                // replay of a stolen token — kill the entire family so a thief
                // who already rotated cannot keep the session alive.
                logger.warn(`[RefreshToken] Rotated token reused beyond grace for user ${tokenRecord.userId} — revoking family`);
                await this.revokeFamily(familyId, logger);
                return null;
            }

            // Logout (or an earlier reuse detection) terminated this family
            // while the predecessor was still inside its grace window. Honour
            // the termination — otherwise grace would undo an explicit logout.
            if (await this.isFamilyTerminated(familyId)) {
                logger.warn(`[RefreshToken] Grace reuse refused for user ${tokenRecord.userId} — family already terminated`);
                return null;
            }
        }

        // 4. Get User
        const user = await authService.getUserById(tokenRecord.userId);
        if (!user) return null;

        // 5. Mint the successor into the SAME family. Created before the old row
        // is touched — the reverse order could revoke and then fail to create,
        // locking the user out.
        const newRefreshToken = await this.createRefreshToken(user.id, familyId);

        if (tokenRecord.revokedAt) {
            // Grace path: the predecessor is already revoked and points at the
            // racing winner's token. Leave it untouched — its grace window keeps
            // ticking, and the new token is reachable via the family regardless.
            logger.info(`[RefreshToken] Grace reuse within ${ROTATION_GRACE_MS / 1000}s of rotation for user ${user.id} (concurrent-tab race)`);
        } else {
            // 6. Revoke the old token, recording its successor. That hash is what
            // marks the revocation as rotation (grace-eligible) rather than
            // terminal. familyId is written too so legacy rows join their family.
            await db
                .update(refreshTokens)
                .set({
                    revokedAt: new Date(),
                    replacedByTokenHash: sha256Hex(newRefreshToken),
                    familyId,
                    updatedAt: new Date(),
                })
                .where(eq(refreshTokens.id, tokenRecord.id));
        }

        return { user, newRefreshToken };
    }

    /**
     * Whether this family has been terminally revoked — i.e. any member was
     * revoked WITHOUT a successor, which only logout and reuse detection do.
     * Rotation always records a successor, so ordinary rotation never trips it.
     */
    private async isFamilyTerminated(familyId: string): Promise<boolean> {
        const terminated = await db
            .select({ id: refreshTokens.id })
            .from(refreshTokens)
            .where(and(
                eq(refreshTokens.familyId, familyId),
                isNotNull(refreshTokens.revokedAt),
                isNull(refreshTokens.replacedByTokenHash),
            ));

        return terminated.length > 0;
    }

    /**
     * Revoke every live token in a rotation family — the theft response and the
     * teeth behind logout. One statement, so grace-minted branches (which are
     * NOT on the replacedByTokenHash chain) are covered too. Deliberately
     * leaves replacedByTokenHash null on the rows it revokes: that absence is
     * what marks the family terminated and permanently blocks grace reuse.
     *
     * Best-effort — a DB error is logged, not thrown: every caller has already
     * decided to reject or end the session.
     */
    private async revokeFamily(familyId: string, logger: Logger): Promise<void> {
        try {
            await db
                .update(refreshTokens)
                .set({ revokedAt: new Date(), updatedAt: new Date() })
                .where(and(
                    eq(refreshTokens.familyId, familyId),
                    isNull(refreshTokens.revokedAt),
                ));
        } catch (error) {
            logger.error(`[RefreshToken] Family revocation failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Revoke a refresh token (Logout)
     *
     * Kills the presented token AND the rest of its family, so logging out
     * really ends this login — including any successor minted through the
     * grace window, which a single-row revoke would have left alive.
     * Other devices have their own families and are unaffected.
     */
    async revokeRefreshToken(rawToken: string, logger: Logger = noopLogger): Promise<void> {
        const tokenHash = sha256Hex(rawToken);

        const [tokenRecord] = await db
            .select()
            .from(refreshTokens)
            .where(eq(refreshTokens.tokenHash, tokenHash));

        // Always revoke the presented row: it may predate family_id, and a
        // logout must succeed even if the row is already rotated away.
        await db
            .update(refreshTokens)
            .set({ revokedAt: new Date() })
            .where(eq(refreshTokens.tokenHash, tokenHash));

        if (tokenRecord?.familyId) {
            await this.revokeFamily(tokenRecord.familyId, logger);
        }
    }
}

export const refreshTokenService = new RefreshTokenService();
