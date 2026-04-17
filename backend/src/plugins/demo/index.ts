/**
 * Demo Mode Plugin
 * 
 * A self-contained Fastify plugin for demo functionality.
 * Allows testing the app without Facebook API approval.
 * 
 * Register conditionally:
 *   if (config.demo.enabled) {
 *     await server.register(demoPlugin);
 *   }
 */

import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../../config';
import { authService } from '../../services/auth';
import { cookiesService } from '../../services/cookies';
import { refreshTokenService } from '../../services/refreshToken';
import { settingsService } from '../../services/settings';
import { workspaceService } from '../../services/workspace';
import { integrationRegistry } from '../../integrations';
import type { AuthResponse } from '../../types';
import { seedDemoData } from './seedData';

async function demoPlugin(fastify: FastifyInstance) {
    // Only register routes if demo mode is enabled
    if (!config.demo.enabled) {
        fastify.log.warn('[Demo] Demo plugin registered but DEMO_MODE_ENABLED is false');
        return;
    }

    fastify.log.info('[Demo] Demo mode plugin registered');

    /**
     * Demo Login
     * POST /auth/demo
     * 
     * Creates a demo user with sample data for testing
     */
    fastify.post('/auth/demo', async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            request.log.info('[Demo] Starting demo login');

            // 1. Find or create demo user
            const user = await authService.findOrCreateUser(
                config.demo.userFacebookId,
                config.demo.userName,
                config.demo.userEmail,
                undefined,
                undefined,
                undefined
            );

            request.log.info({ userId: user.id }, '[Demo] Demo user ready');

            // 2. Get the workspace (ensureWorkspace runs inside findOrCreateUser)
            const workspaces = await workspaceService.getUserWorkspaces(user.id);
            const workspaceId = workspaces[0]?.id;
            if (!workspaceId) throw new Error('Demo workspace not found after user creation');

            // 3. Seed demo data for this user (pages, comments, templates)
            await seedDemoData(user.id, workspaceId, request.log);

            // 4. Generate JWT token
            const token = authService.generateToken(user);

            // 5. Fetch user settings
            const userSettings = await settingsService.getSettings(user.id);

            // 6. Generate refresh token
            const refreshToken = await refreshTokenService.createRefreshToken(user.id);

            // 7. Set cookies
            cookiesService.setAuthCookies(reply, token);
            cookiesService.setRefreshTokenCookie(reply, refreshToken);

            // 8. Build response — mirror the real Facebook login (workspaces + requiresPhone)
            const requiresPhone = config.phoneAuthEnabled && !user.phone ? true : undefined;
            const response: AuthResponse = authService.createAuthResponse(
                user,
                token,
                'demo_token',
                { dashboardLanguage: userSettings.dashboardLanguage },
                workspaces,
                requiresPhone,
            );

            // 9. Claim any pending e-commerce integration installs (parity with real login)
            for (const integration of integrationRegistry.getEnabled()) {
                const claim = await integration.claimPendingInstall(request, reply, user.id);
                if (claim) Object.assign(response, claim);
            }

            return reply.send({
                ...response,
                isDemo: true,
            });

        } catch (error) {
            request.log.error({ err: error }, 'Demo login failed');
            return reply.status(500).send({
                error: 'Demo login failed',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    });

    /**
     * Check Demo Mode Status
     * GET /auth/demo/status
     * 
     * Returns whether demo mode is available
     */
    fastify.get('/auth/demo/status', async (_request: FastifyRequest, reply: FastifyReply) => {
        return reply.send({
            enabled: config.demo.enabled,
        });
    });
}

export default demoPlugin;
