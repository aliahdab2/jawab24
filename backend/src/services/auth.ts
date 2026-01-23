import { db } from '../db';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';
import { config } from '../config';
import crypto from 'crypto';
import type { User, JWTPayload, AuthResponse } from '../types';
import { subscriptionsService } from './subscriptions';
// Simple but secure JWT-like implementation using HMAC
// For production, consider using @fastify/jwt plugin
const ALGORITHM = 'sha256';
const LEGACY_TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days (Keep for backward compatibility)

export const ACCESS_TOKEN_EXPIRY = 15 * 60 * 1000; // 15 minutes

export class AuthService {
    /**
     * Find or create user by Facebook ID
     */
    async findOrCreateUser(
        facebookId: string,
        name: string,
        email?: string,
        facebookAccessToken?: string,
        facebookTokenExpiresAt?: Date,
        picture?: string
    ): Promise<User> {
        // Check if user exists
        const existingUsers = await db.select().from(users).where(eq(users.facebookId, facebookId));

        if (existingUsers.length > 0) {
            // Update user info if changed
            const user = existingUsers[0];
            // Update only if data changed to minimize writes
            // Always update access token if provided
            await db
                .update(users)
                .set({
                    name,
                    email,
                    picture: picture || user.picture,
                    facebookAccessToken: facebookAccessToken || user.facebookAccessToken,
                    facebookTokenExpiresAt: facebookTokenExpiresAt || user.facebookTokenExpiresAt,
                    updatedAt: new Date(),
                })
                .where(eq(users.id, user.id));

            return {
                ...user,
                name,
                email: email ?? null,
                picture: picture || user.picture,
                facebookAccessToken: facebookAccessToken || user.facebookAccessToken,
                facebookTokenExpiresAt: facebookTokenExpiresAt || user.facebookTokenExpiresAt,
                updatedAt: new Date()
            };
        }

        // Create new user
        const newUsers = await db
            .insert(users)
            .values({
                facebookId,
                name,
                email,
                picture,
                facebookAccessToken,
                facebookTokenExpiresAt,
            })
            .returning();

        const newUser = newUsers[0];

        // Create subscription for new user (with free trial)
        await this.createSubscriptionForNewUser(newUser.id);

        return newUser;
    }

    /**
     * Create subscription for a new user
     */
    private async createSubscriptionForNewUser(userId: string): Promise<void> {
        try {
            await subscriptionsService.createSubscription(userId);
            // Note: In production, use a proper logger
        } catch {
            // Log but don't fail the auth if subscription creation fails
            // Error is silently handled to not block authentication
        }
    }

    /**
     * Ensure user has a subscription (for existing users who might not have one)
     */
    private async ensureSubscription(userId: string): Promise<void> {
        try {
            const existing = await subscriptionsService.getUserSubscription(userId);
            if (!existing) {
                await subscriptionsService.createSubscription(userId);
            }
        } catch {
            // Error is silently handled to not block authentication
        }
    }

    /**
     * Generate secure token for user
     * Uses HMAC signature with expiry timestamp
     */
    generateToken(user: User, expiryMs: number = LEGACY_TOKEN_EXPIRY_MS): string {
        const payload: JWTPayload & { exp: number } = {
            userId: user.id,
            facebookId: user.facebookId,
            exp: Date.now() + expiryMs,
        };

        const payloadStr = Buffer.from(JSON.stringify(payload)).toString('base64url');
        const signature = this.sign(payloadStr);

        return `${payloadStr}.${signature}`;
    }

    /**
     * Verify and decode token
     */

    /**
     * Verify and decode token
     */
    verifyToken(token: string): JWTPayload | null {
        try {
            const parts = token.split('.');
            if (parts.length !== 2) {
                return null;
            }

            const [payloadStr, signature] = parts;

            // Verify signature
            const expectedSignature = this.sign(payloadStr);
            if (!crypto.timingSafeEqual(
                Buffer.from(signature),
                Buffer.from(expectedSignature)
            )) {
                return null;
            }

            // Decode payload
            const payload = JSON.parse(
                Buffer.from(payloadStr, 'base64url').toString('utf-8')
            ) as JWTPayload & { exp?: number };

            // Check expiry
            if (payload.exp && payload.exp < Date.now()) {
                return null;
            }

            return {
                userId: payload.userId,
                facebookId: payload.facebookId,
            };
        } catch {
            return null;
        }
    }

    /**
     * Create HMAC signature
     */
    private sign(data: string): string {
        return crypto
            .createHmac(ALGORITHM, config.jwt.secret)
            .update(data)
            .digest('base64url');
    }

    /**
     * Get user by ID
     */
    async getUserById(userId: string): Promise<User | null> {
        const result = await db.select().from(users).where(eq(users.id, userId));
        return result.length > 0 ? result[0] : null;
    }

    /**
     * Create auth response
     */
    createAuthResponse(user: User, token: string, fbAccessToken: string, settings?: { dashboardLanguage: string }): AuthResponse {
        return {
            token,
            fbAccessToken,
            user: {
                id: user.id,
                name: user.name || '',
                email: user.email || undefined,
                facebookId: user.facebookId,
                picture: user.picture || undefined,
                isAdmin: user.isAdmin || false,
            },
            settings,
        };
    }

    async deleteUser(userId: string): Promise<void> {
        await db.delete(users).where(eq(users.id, userId));
    }

}

export const authService = new AuthService();
