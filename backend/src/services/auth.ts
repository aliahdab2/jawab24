import { db } from '../db';
import {
    users, refreshTokens, pages, posts, instagramMedia,
    comments, instagramComments, messages, conversationPauses,
    templates, rules, settings, logs, subscriptions, usage,
    usageLogs, deviceTokens, notifications, shopifyStores, shopifyProducts,
    pendingShopifyInstalls,
} from '../db/schema';
import { eq, inArray, sql } from 'drizzle-orm';
import { config } from '../config';
import crypto from 'crypto';
import { encryptFbToken, decryptFbToken } from './facebookCrypto';
import type { User, JWTPayload, AuthResponse } from '../types';
import { subscriptionsService } from './subscriptions';
import { captureError } from '../utils/sentryHelpers';
// Secure JWT-like implementation using HMAC
const ALGORITHM = 'sha256';
const LEGACY_TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days (Keep for backward compatibility)

export const ACCESS_TOKEN_EXPIRY = 15 * 60 * 1000; // 15 minutes

export class AuthService {
    /** Encrypt token only when FACEBOOK_TOKEN_ENCRYPTION_KEY is configured. */
    private maybeEncrypt(token: string | undefined): string | undefined {
        if (!token || !config.facebook.tokenEncryptionKey) return token;
        return encryptFbToken(token);
    }

    /** Decrypt token — falls back gracefully to plaintext for legacy rows. */
    private maybeDecrypt(stored: string | null | undefined): string | null | undefined {
        if (!stored || !config.facebook.tokenEncryptionKey) return stored;
        return decryptFbToken(stored);
    }

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
            const tokenToStore = this.maybeEncrypt(facebookAccessToken) ?? user.facebookAccessToken;
            await db
                .update(users)
                .set({
                    name,
                    email,
                    picture: picture || user.picture,
                    facebookAccessToken: tokenToStore,
                    facebookTokenExpiresAt: facebookTokenExpiresAt || user.facebookTokenExpiresAt,
                    updatedAt: new Date(),
                })
                .where(eq(users.id, user.id));

            // Ensure returning users have a subscription (fixes edge case where
            // initial subscription creation failed silently during signup)
            await this.ensureSubscription(user.id);

            return {
                ...user,
                name,
                email: email ?? null,
                picture: picture || user.picture,
                // Return the plaintext token in memory — callers never see the encrypted form
                facebookAccessToken: facebookAccessToken ?? this.maybeDecrypt(user.facebookAccessToken),
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
                facebookAccessToken: this.maybeEncrypt(facebookAccessToken),
                facebookTokenExpiresAt,
            })
            .returning();

        const newUser = newUsers[0];

        // Create subscription for new user (with free trial)
        await this.createSubscriptionForNewUser(newUser.id);

        // Return plaintext token in memory — the DB row holds the encrypted form
        return {
            ...newUser,
            facebookAccessToken: this.maybeDecrypt(newUser.facebookAccessToken),
        };
    }

    /**
     * Create subscription for a new user
     */
    private async createSubscriptionForNewUser(userId: string): Promise<void> {
        try {
            await subscriptionsService.createSubscription(userId);
        } catch (error) {
            captureError(error, 'Failed to create subscription for new user', { tags: { context: 'auth', action: 'create-subscription' }, extra: { userId } });
            // Retry once before giving up
            try {
                await subscriptionsService.createSubscription(userId);
            } catch (retryError) {
                captureError(retryError, 'Subscription creation retry also failed', { level: 'fatal', tags: { context: 'auth', action: 'create-subscription-retry' }, extra: { userId } });
            }
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
        } catch (error) {
            captureError(error, 'Failed to ensure subscription', { tags: { context: 'auth', action: 'ensure-subscription' }, extra: { userId } });
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
            isAdmin: user.isAdmin || false,
            exp: Date.now() + expiryMs,
        };

        const payloadStr = Buffer.from(JSON.stringify(payload)).toString('base64url');
        const signature = this.sign(payloadStr);

        return `${payloadStr}.${signature}`;
    }

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
                isAdmin: payload.isAdmin || false,
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
        if (result.length === 0) return null;
        const user = result[0];
        return {
            ...user,
            facebookAccessToken: this.maybeDecrypt(user.facebookAccessToken),
        };
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

    /**
     * Delete user and all associated data in explicit order.
     * Uses a transaction with ordered deletes (leaf → root) to avoid FK violations.
     * Does NOT rely on CASCADE — makes deletion behavior explicit and debuggable.
     */
    async deleteUser(userId: string): Promise<void> {
        await db.transaction(async (tx) => {
            // Guard: prevent transaction from hanging (20s max)
            await tx.execute(sql`SET LOCAL statement_timeout = '20s'`);

            // 1. Resolve user's page IDs (needed for multi-level deletes)
            const userPages = await tx.select({ id: pages.id }).from(pages).where(eq(pages.userId, userId));
            const pageIds = userPages.map(p => p.id);

            if (pageIds.length > 0) {
                // 2. Resolve post and media IDs under those pages
                const userPosts = await tx.select({ id: posts.id }).from(posts).where(inArray(posts.pageId, pageIds));
                const postIds = userPosts.map(p => p.id);

                const userMedia = await tx.select({ id: instagramMedia.id }).from(instagramMedia).where(inArray(instagramMedia.pageId, pageIds));
                const mediaIds = userMedia.map(m => m.id);

                // 3. Delete leaf-level data (comments, instagram comments)
                if (postIds.length > 0) {
                    await tx.delete(logs).where(inArray(logs.commentId,
                        tx.select({ id: comments.id }).from(comments).where(inArray(comments.postId, postIds))
                    ));
                    await tx.delete(comments).where(inArray(comments.postId, postIds));
                }
                if (mediaIds.length > 0) {
                    await tx.delete(instagramComments).where(inArray(instagramComments.mediaId, mediaIds));
                }

                // 4. Delete page-level data
                await tx.delete(messages).where(inArray(messages.pageId, pageIds));
                await tx.delete(conversationPauses).where(inArray(conversationPauses.pageId, pageIds));
                await tx.delete(posts).where(inArray(posts.pageId, pageIds));
                await tx.delete(instagramMedia).where(inArray(instagramMedia.pageId, pageIds));
            }

            // 5. Delete user-level data (order doesn't matter — all reference users directly)
            await tx.delete(logs).where(eq(logs.userId, userId));
            await tx.delete(usageLogs).where(eq(usageLogs.userId, userId));
            await tx.delete(rules).where(eq(rules.userId, userId));
            await tx.delete(templates).where(eq(templates.userId, userId));
            await tx.delete(settings).where(eq(settings.userId, userId));
            await tx.delete(subscriptions).where(eq(subscriptions.userId, userId));
            await tx.delete(usage).where(eq(usage.userId, userId));
            await tx.delete(deviceTokens).where(eq(deviceTokens.userId, userId));
            await tx.delete(notifications).where(eq(notifications.userId, userId));
            await tx.delete(refreshTokens).where(eq(refreshTokens.userId, userId));

            // 6. Delete Shopify data (shopifyProducts → shopifyStores → pages.shopifyStoreId)
            const userStores = await tx.select({ id: shopifyStores.id }).from(shopifyStores).where(eq(shopifyStores.userId, userId));
            const storeIds = userStores.map(s => s.id);
            if (storeIds.length > 0) {
                await tx.delete(shopifyProducts).where(inArray(shopifyProducts.shopifyStoreId, storeIds));
            }
            await tx.delete(shopifyStores).where(eq(shopifyStores.userId, userId));

            // 6b. Nullify pending Shopify installs claimed by this user
            await tx.update(pendingShopifyInstalls)
                .set({ claimedByUserId: null })
                .where(eq(pendingShopifyInstalls.claimedByUserId, userId));

            // 7. Delete pages (now safe — all children removed)
            if (pageIds.length > 0) {
                await tx.delete(pages).where(inArray(pages.id, pageIds));
            }

            // 8. Finally, delete the user
            const result = await tx.delete(users).where(eq(users.id, userId)).returning({ id: users.id });
            if (result.length === 0) {
                throw new Error(`User ${userId} not found`);
            }
        });
    }

}

export const authService = new AuthService();
