import { FastifyReply, FastifyRequest } from 'fastify';
import { authService } from '../services/auth';
import { facebookService } from '../services/facebook';
import { pagesService } from '../services/pages';
import { settingsService } from '../services/settings';
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
                fbProfile.email
            );

            // 4. Generate JWT token
            const token = authService.generateToken(user);

            // 5. Auto-sync pages from Facebook (non-blocking)
            pagesService.syncFromFacebook(user.id, accessToken).catch((err) => {
                request.log.error({ err }, 'Auto-sync pages failed');
            });

            // 6. Fetch user settings for immediate UI sync
            const userSettings = await settingsService.getSettings(user.id);

            // 7. Return response
            const response = authService.createAuthResponse(user, token, accessToken, {
                dashboardLanguage: userSettings.dashboardLanguage,
            });
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
        } catch (error) {
            request.log.error({ err: error }, 'Delete account failed');
            return reply.status(500).send({ error: 'Internal Server Error' });
        }
    }
}

export const authController = new AuthController();

