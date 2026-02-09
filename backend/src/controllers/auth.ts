import { FastifyReply, FastifyRequest } from 'fastify';
import { authService, ACCESS_TOKEN_EXPIRY } from '../services/auth';
import { cookiesService } from '../services/cookies';
import { refreshTokenService } from '../services/refreshToken';
import { facebookService } from '../services/facebook';
import { pagesService } from '../services/pages';
import { settingsService } from '../services/settings';
import { integrationRegistry } from '../integrations';
import { AuthRequest } from '../types';
import { AuthenticatedRequest } from '../middleware/auth';
import { db } from '../db';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';

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

            // 2. Get user profile from Facebook
            const fbProfile = await facebookService.getUserProfile(accessToken);

            // 3. Find or create user in our DB
            const user = await authService.findOrCreateUser(
                fbProfile.id,
                fbProfile.name,
                fbProfile.email,
                undefined, // facebookAccessToken - handled below
                undefined, // facebookTokenExpiresAt - handled below
                fbProfile.picture
            );

            // 4. Generate JWT token
            const token = authService.generateToken(user);

            // 5. Auto-sync pages from Facebook (non-blocking)
            pagesService.syncFromFacebook(user.id, accessToken).catch((err) => {
                request.log.error({ err }, 'Auto-sync pages failed');
            });

            // 6. Fetch user settings for immediate UI sync
            const userSettings = await settingsService.getSettings(user.id);

            // 7. Generate refresh token (Level 2 Security)
            const refreshToken = await refreshTokenService.createRefreshToken(user.id);

            // 8. Set cookies (HttpOnly + CSRF + Refresh)
            cookiesService.setAuthCookies(reply, token);
            cookiesService.setRefreshTokenCookie(reply, refreshToken);

            // 9. Build response
            const response: Record<string, any> = authService.createAuthResponse(user, token, accessToken, {
                dashboardLanguage: userSettings.dashboardLanguage,
            });

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

            // 7. Auto-sync pages (Non-blocking)
            pagesService.syncFromFacebook(user.id, longLivedToken).catch((err) => {
                request.log.error({ err }, 'Auto-sync pages failed (Native Flow)');
            });

            // 8. Fetch user settings
            const userSettings = await settingsService.getSettings(user.id);

            // 9. Set cookies (HttpOnly + CSRF)
            cookiesService.setAuthCookies(reply, token);

            // 10. Build response
            const response: Record<string, any> = authService.createAuthResponse(user, token, longLivedToken, {
                dashboardLanguage: userSettings.dashboardLanguage,
            });

            // 11. Check for pending e-commerce integration installs
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
            return reply.send({
                id: user.id,
                facebookId: user.facebookId,
                name: user.name,
                email: user.email,
                hasEmail: !!user.email,
                isAdmin: user.isAdmin || false,
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
            await authService.deleteUser(userId);
            return reply.send({ success: true, message: 'Account deleted successfully' });
        } catch (error: any) {
            request.log.error({ err: error, userId, errorCode: error?.code, errorDetail: error?.detail }, 'Delete account failed');
            if (error?.message?.includes('not found')) {
                return reply.status(404).send({ error: 'User not found' });
            }
            return reply.status(500).send({ error: 'Internal Server Error' });
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

