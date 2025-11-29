import { FastifyReply, FastifyRequest } from 'fastify';
import { authService } from '../services/auth';
import { facebookService } from '../services/facebook';
import { AuthRequest } from '../types';

export class AuthController {
    /**
     * Handle Facebook Login
     * POST /auth/facebook
     */
    async facebookLogin(request: FastifyRequest<{ Body: AuthRequest }>, reply: FastifyReply) {
        const { code } = request.body;

        if (!code) {
            return reply.status(400).send({ error: 'Authorization code is required' });
        }

        try {
            // 1. Exchange code for access token
            const accessToken = await facebookService.getAccessToken(code);

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

            // 5. Return response
            const response = authService.createAuthResponse(user, token, accessToken);
            return reply.send(response);

        } catch (error) {
            request.log.error(error);
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
    async getMe(request: FastifyRequest, reply: FastifyReply) {
        // @ts-ignore - user is attached by middleware
        const userId = request.user?.userId;

        if (!userId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }

        try {
            const user = await authService.getUserById(userId);
            if (!user) {
                return reply.status(404).send({ error: 'User not found' });
            }
            return reply.send(user);
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Internal Server Error' });
        }
    }
}

export const authController = new AuthController();

