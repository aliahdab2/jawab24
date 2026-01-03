import { FastifyReply, FastifyRequest } from 'fastify';
import { settingsService, UpdateSettingsDTO } from '../services/settings';

/** Authenticated request with user info */
interface AuthenticatedRequest extends FastifyRequest {
    user: { id: string };
}

export class SettingsController {
    /**
     * Get user settings
     * GET /settings
     */
    async get(request: FastifyRequest, reply: FastifyReply) {
        try {
            const userId = (request as AuthenticatedRequest).user.id;
            const settings = await settingsService.getSettings(userId);
            return reply.send(settings);
        } catch (error) {
            request.log.error({ error: String(error) }, 'Error getting settings');
            return reply.status(500).send({ error: 'Failed to get settings' });
        }
    }

    /**
     * Update user settings
     * PUT /settings
     */
    async update(request: FastifyRequest<{ Body: UpdateSettingsDTO }>, reply: FastifyReply) {
        try {
            const userId = (request as AuthenticatedRequest).user.id;
            const updates = request.body;
            const settings = await settingsService.updateSettings(userId, updates);
            return reply.send(settings);
        } catch (error) {
            request.log.error({ error: String(error) }, 'Error updating settings');
            return reply.status(500).send({ error: 'Failed to update settings' });
        }
    }
}

export const settingsController = new SettingsController();










