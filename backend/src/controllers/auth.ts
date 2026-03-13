import { FastifyReply, FastifyRequest } from 'fastify';
import { authService, ACCESS_TOKEN_EXPIRY } from '../services/auth';
import { cookiesService } from '../services/cookies';
import { refreshTokenService } from '../services/refreshToken';
import { facebookService } from '../services/facebook';
import { pagesService } from '../services/pages';
import { settingsService } from '../services/settings';
import { integrationRegistry } from '../integrations';
import { AuthRequest, AuthResponse } from '../types';
import { AuthenticatedRequest } from '../middleware/auth';
import { db } from '../db';
import { users, ecommerceStores } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { auditLog } from '../services/auditLog';
import { workspaceService } from '../services/workspace';

export class AuthController {
    /**
     * Handle Facebook Login
     * POST /auth/facebook
     */
    async facebookLogin(request: FastifyRequest<{ Body: AuthRequest }>, reply: FastifyReply) {
        const { code, redirectUri } = request.body;

        if (!code) {
            return reply.status(400).send({ error: 'Authorization code is required' });
        }

        try {
            // 1. Exchange code for access token
            const accessToken = await facebookService.getAccessToken(code, redirectUri);

            // 1b. Exchange for long-lived token (60 days) so picture refresh works for web users
            let longLivedToken = accessToken;
            let tokenExpiresAt: Date | undefined;
            try {
                const { token: llt, expiresAt } = await facebookService.getLongLivedToken(accessToken);
                longLivedToken = llt;
                tokenExpiresAt = expiresAt;
            } catch (err) {
                request.log.warn({ err }, 'Could not exchange for long-lived token, using short-lived');
            }

            // 2. Get user profile from Facebook
            const fbProfile = await facebookService.getUserProfile(longLivedToken);

            // 3. Find or create user in our DB (store long-lived token for picture refresh)
            const user = await authService.findOrCreateUser(
                fbProfile.id,
                fbProfile.name,
                fbProfile.email,
                longLivedToken,
                tokenExpiresAt,
                fbProfile.picture
            );

            // 4. Generate JWT token
            const token = authService.generateToken(user);

            // 5. Fetch user settings + workspaces for immediate UI sync
            const [userSettings, workspaces] = await Promise.all([
                settingsService.getSettings(user.id),
                workspaceService.getUserWorkspaces(user.id),
            ]);

            // 6. Sync pages from Facebook (awaited — ensures pages exist when onboarding wizard loads)
            const syncWorkspaceId = workspaces[0]?.id;
            if (syncWorkspaceId) {
                try {
                    const syncResult = await pagesService.syncFromFacebook(syncWorkspaceId, user.id, longLivedToken);
                    if (syncResult && syncResult.skippedCount > 0) {
                        request.log.info(`Auto-sync: ${syncResult.skippedCount} page(s) created but auto-reply disabled (plan limit)`);
                    }
                    if (syncResult && (syncResult.revokedCount ?? 0) > 0) {
                        request.log.info(`Auto-sync: ${syncResult.revokedCount} page(s) disconnected (access revoked in Facebook)`);
                    }
                } catch (err) {
                    request.log.error({ err }, 'Auto-sync pages failed (non-fatal)');
                }
            }

            // 7. Generate refresh token (Level 2 Security)
            const refreshToken = await refreshTokenService.createRefreshToken(user.id);

            // 8. Set cookies (HttpOnly + CSRF + Refresh)
            cookiesService.setAuthCookies(reply, token);
            cookiesService.setRefreshTokenCookie(reply, refreshToken);

            // 9. Build response
            const response: AuthResponse = authService.createAuthResponse(user, token, longLivedToken, {
                dashboardLanguage: userSettings.dashboardLanguage,
            }, workspaces);

            // 10. Check for pending e-commerce integration installs
            for (const integration of integrationRegistry.getEnabled()) {
                const claim = await integration.claimPendingInstall(request, reply, user.id);
                if (claim) Object.assign(response, claim);
            }

            return reply.send(response);

        } catch (error) {
            request.log.error({ err: error }, 'Facebook login failed');
            return reply.status(401).send({
                error: 'Authentication failed',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * Handle Native Mobile Facebook Login
     * POST /auth/facebook/native
     */
    async nativeLogin(request: FastifyRequest<{ Body: { accessToken: string } }>, reply: FastifyReply) {
        const { accessToken } = request.body;

        if (!accessToken) {
            return reply.status(400).send({ error: 'Access token is required' });
        }

        try {
            // 1. Verify the provided token (Security Check: App Match & Scopes)
            const { scopes } = await facebookService.verifyAccessToken(accessToken);

            // Enforce critical permissions
            if (!scopes.includes('pages_show_list')) {
                return reply.status(403).send({
                    error: 'Missing Permissions',
                    code: 'MISSING_PERMISSIONS',
                    message: 'We need permission to view your pages to manage auto-replies. Please try logging in again and grant "Manage Pages" access.'
                });
            }

            // Track Instagram permission status (informational, not blocking)
            const hasInstagram = scopes.includes('instagram_basic');
            request.log.info({ hasInstagram, scopes }, 'Login permissions granted');

            // 2. Exchange for Long-Lived Token (Critical for Background Jobs)
            const { token: longLivedToken, expiresAt } = await facebookService.getLongLivedToken(accessToken);

            // 3. Get user profile from Facebook (using the secure long-lived token)
            const fbProfile = await facebookService.getUserProfile(longLivedToken);

            // 4. Find or create user in our DB (Store the long-lived token!)
            const user = await authService.findOrCreateUser(
                fbProfile.id,
                fbProfile.name,
                fbProfile.email,
                longLivedToken,
                expiresAt,
                fbProfile.picture
            );

            // 5. Store Instagram permission status
            if (hasInstagram) {
                await db.update(users).set({ hasInstagramPermission: true }).where(eq(users.id, user.id));
            }

            // 6. Generate Internal JWT
            const token = authService.generateToken(user);

            // 7. Fetch user settings + workspaces
            const [userSettings, workspaces] = await Promise.all([
                settingsService.getSettings(user.id),
                workspaceService.getUserWorkspaces(user.id),
            ]);

            // 8. Sync pages from Facebook (awaited — ensures pages exist when onboarding wizard loads)
            const syncWorkspaceId = workspaces[0]?.id;
            if (syncWorkspaceId) {
                try {
                    const syncResult = await pagesService.syncFromFacebook(syncWorkspaceId, user.id, longLivedToken);
                    if (syncResult && syncResult.skippedCount > 0) {
                        request.log.info(`Auto-sync: ${syncResult.skippedCount} page(s) created but auto-reply disabled (plan limit)`);
                    }
                    if (syncResult && (syncResult.revokedCount ?? 0) > 0) {
                        request.log.info(`Auto-sync: ${syncResult.revokedCount} page(s) disconnected (access revoked in Facebook)`);
                    }
                } catch (err) {
                    request.log.error({ err }, 'Auto-sync pages failed (non-fatal, Native Flow)');
                }
            }

            // 9. Generate refresh token (same as web login)
            const refreshToken = await refreshTokenService.createRefreshToken(user.id);

            // 10. Set cookies (HttpOnly + CSRF + Refresh)
            cookiesService.setAuthCookies(reply, token);
            cookiesService.setRefreshTokenCookie(reply, refreshToken);

            // 11. Build response
            const response: AuthResponse = authService.createAuthResponse(user, token, longLivedToken, {
                dashboardLanguage: userSettings.dashboardLanguage,
            }, workspaces);

            // 12. Check for pending e-commerce integration installs
            for (const integration of integrationRegistry.getEnabled()) {
                const claim = await integration.claimPendingInstall(request, reply, user.id);
                if (claim) Object.assign(response, claim);
            }

            return reply.send(response);

        } catch (error) {
            request.log.error({ err: error }, 'Native Facebook login failed');
            return reply.status(401).send({
                error: 'Authentication failed',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * Refresh profile picture from Facebook using stored access token
     * GET /auth/picture/refresh
     */
    async refreshPicture(request: AuthenticatedRequest, reply: FastifyReply) {
        const userId = request.user?.userId;
        if (!userId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }

        try {
            const user = await authService.getUserById(userId);
            if (!user) {
                return reply.status(404).send({ error: 'User not found' });
            }

            const fbToken = user.facebookAccessToken;
            if (!fbToken) {
                return reply.status(422).send({ error: 'No Facebook token available' });
            }

            const fbProfile = await facebookService.getUserProfile(fbToken);
            if (!fbProfile.picture) {
                return reply.status(422).send({ error: 'No picture returned from Facebook' });
            }

            // Save fresh URL to DB
            await db.update(users).set({ picture: fbProfile.picture }).where(eq(users.id, userId));

            return reply.send({ picture: fbProfile.picture });
        } catch (error) {
            request.log.error({ err: error }, 'Refresh picture failed');
            return reply.status(500).send({ error: 'Internal Server Error' });
        }
    }

    /**
     * Get current user
     * GET /auth/me
     */
    async getMe(request: AuthenticatedRequest, reply: FastifyReply) {
        const userId = request.user?.userId;

        if (!userId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }

        try {
            const user = await authService.getUserById(userId);
            if (!user) {
                return reply.status(404).send({ error: 'User not found' });
            }

            const storeRows = await db.select({ id: ecommerceStores.id })
                .from(ecommerceStores)
                .where(and(eq(ecommerceStores.userId, userId), eq(ecommerceStores.isActive, true)))
                .limit(1);

            return reply.send({
                id: user.id,
                facebookId: user.facebookId,
                name: user.name,
                email: user.email,
                hasEmail: !!user.email,
                isAdmin: user.isAdmin || false,
                hasEcommerceStore: storeRows.length > 0,
                createdAt: user.createdAt,
                updatedAt: user.updatedAt,
            });
        } catch (error) {
            request.log.error({ err: error }, 'Get user failed');
            return reply.status(500).send({ error: 'Internal Server Error' });
        }
    }

    /**
     * Update user profile
     * PATCH /auth/profile
     */
    async updateProfile(request: AuthenticatedRequest, reply: FastifyReply) {
        const userId = request.user?.userId;

        if (!userId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }

        const { email, name } = request.body as { email?: string; name?: string };

        if (!email && !name) {
            return reply.status(400).send({ error: 'No fields to update' });
        }

        try {
            // Validate email format if provided
            if (email) {
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (!emailRegex.test(email)) {
                    return reply.status(400).send({ error: 'Invalid email format' });
                }
            }

            // Update user
            const updateData: { email?: string; name?: string; updatedAt: Date } = {
                updatedAt: new Date(),
            };
            if (email !== undefined) updateData.email = email;
            if (name !== undefined) updateData.name = name;

            await db.update(users)
                .set(updateData)
                .where(eq(users.id, userId));

            // Fetch updated user
            const [user] = await db.select().from(users).where(eq(users.id, userId));

            if (!user) {
                return reply.status(404).send({ error: 'User not found' });
            }

            return reply.send({
                id: user.id,
                facebookId: user.facebookId,
                name: user.name,
                email: user.email,
                hasEmail: !!user.email,
                createdAt: user.createdAt,
                updatedAt: user.updatedAt,
            });
        } catch (error) {
            request.log.error({ err: error }, 'Update profile failed');
            return reply.status(500).send({ error: 'Internal Server Error' });
        }
    }
    /**
     * Delete user account
     * DELETE /auth/me
     */
    async deleteAccount(request: AuthenticatedRequest, reply: FastifyReply) {
        const userId = request.user?.userId;

        if (!userId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }

        try {
            // Audit BEFORE deletion (user row will be gone after)
            await auditLog({ userId, action: 'account.deleted', entityType: 'user' });

            await authService.deleteUser(userId);
            return reply.send({ success: true, message: 'Account deleted successfully' });
        } catch (error: unknown) {
            const err = error as { message?: string; code?: string; detail?: string };
            request.log.error({ err: error, userId, errorCode: err.code, errorDetail: err.detail }, 'Delete account failed');
            if (err.message?.includes('not found')) {
                return reply.status(404).send({ error: 'User not found' });
            }
            // Classify the error for debugging
            const code = err.code === '23503' ? 'FK_VIOLATION'
                : err.code === '40P01' ? 'DEADLOCK'
                : err.message?.includes('timeout') ? 'TIMEOUT'
                : 'DELETE_FAILED';
            return reply.status(500).send({ error: 'Failed to delete account', code });
        }
    }

    /**
     * Logout
     * POST /auth/logout
     */
    async logout(request: FastifyRequest, reply: FastifyReply) {
        // 1. Revoke refresh token if present
        const signedRefreshToken = request.cookies.refreshToken;
        if (signedRefreshToken) {
             const unsigned = request.unsignCookie(signedRefreshToken);
             if (unsigned.valid && unsigned.value) {
                 await refreshTokenService.revokeRefreshToken(unsigned.value);
             }
        }

        // 2. Clear all cookies
        cookiesService.clearAuthCookies(reply);
        return reply.send({ success: true });
    }

    /**
     * Rotate Refresh Token
     * POST /auth/refresh
     */
    async refresh(request: FastifyRequest, reply: FastifyReply) {
        const signedRefreshToken = request.cookies.refreshToken;

        if (!signedRefreshToken) {
            return reply.status(401).send({ error: 'Missing refresh token' });
        }

        const unsigned = request.unsignCookie(signedRefreshToken);
        if (!unsigned.valid || !unsigned.value) {
             return reply.status(401).send({ error: 'Invalid refresh token signature' });
        }
        
        const refreshToken = unsigned.value;

        try {
            // 1. Verify and rotate (get new token, revoke old one)
            const result = await refreshTokenService.rotateRefreshToken(refreshToken);

            if (!result) {
                // Token invalid or revoked - Clear everything to force login
                cookiesService.clearAuthCookies(reply);
                return reply.status(401).send({ error: 'Invalid refresh token' });
            }

            const { user, newRefreshToken } = result;

            // 2. Generate new Access Token
            const newAccessToken = authService.generateToken(user, ACCESS_TOKEN_EXPIRY);

            // 3. Set new cookies
            cookiesService.setAuthCookies(reply, newAccessToken);
            cookiesService.setRefreshTokenCookie(reply, newRefreshToken);

            return reply.send({ success: true, token: newAccessToken });
        } catch (error) {
            request.log.error({ err: error }, 'Token refresh failed');
            return reply.status(401).send({ error: 'Refresh failed' });
        }
    }
}

export const authController = new AuthController();

