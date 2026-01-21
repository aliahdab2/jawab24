import { db } from '../db';
import { refreshTokens } from '../db/schema';
import { eq } from 'drizzle-orm';
import crypto from 'crypto';
import { authService } from './auth';
import type { User } from '../types';

const REFRESH_TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export class RefreshTokenService {
    /**
     * Create a new Refresh Token (Level 2 Security)
     */
    async createRefreshToken(userId: string): Promise<string> {
        // 1. Generate high-entropy random token
        const rawToken = crypto.randomBytes(40).toString('hex');
        
        // 2. Hash it before storage (Security Best Practice)
        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

        // 3. Store in DB
        await db.insert(refreshTokens).values({
            userId,
            tokenHash,
            expiresAt: new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS),
        });

        // 4. Return RAW token to user (we never see it again)
        return rawToken;
    }

    /**
     * Verify and rotate refresh token
     * Returns the user and a NEW refresh token (Rotation)
     */
    async rotateRefreshToken(rawToken: string): Promise<{ user: User; newRefreshToken: string } | null> {
        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

        // 1. Find token in DB
        const [tokenRecord] = await db
            .select()
            .from(refreshTokens)
            .where(eq(refreshTokens.tokenHash, tokenHash));

        if (!tokenRecord) {
            // Potential Reuse Attack: If we stored "replacedBy", we would check it here 
            // and revoke the new family of tokens.
            return null;
        }

        // 2. Check if revoked
        if (tokenRecord.revokedAt) {
            // Security Alert: Revoked token reuse attempt
            return null;
        }

        // 3. Check expiry
        if (tokenRecord.expiresAt < new Date()) {
            return null;
        }

        // 4. Get User
        const user = await authService.getUserById(tokenRecord.userId);
        if (!user) return null;

        // 5. Revoke OLD token
        await db
            .update(refreshTokens)
            .set({ revokedAt: new Date() })
            .where(eq(refreshTokens.id, tokenRecord.id));

        // 6. Create NEW token
        const newRefreshToken = await this.createRefreshToken(user.id);

        return { user, newRefreshToken };
    }

    /**
     * Revoke a refresh token (Logout)
     */
    async revokeRefreshToken(rawToken: string): Promise<void> {
        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
        
        await db
            .update(refreshTokens)
            .set({ revokedAt: new Date() })
            .where(eq(refreshTokens.tokenHash, tokenHash));
    }
}

export const refreshTokenService = new RefreshTokenService();
