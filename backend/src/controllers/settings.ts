import { FastifyReply, FastifyRequest } from 'fastify';
import { settingsService, UpdateSettingsDTO } from '../services/settings';

export class SettingsController {
    /**
     * Get user settings
     * GET /settings
     */
    async get(request: FastifyRequest, reply: FastifyReply) {
        try {
            const userId = (request as any).user.id;
            const settings = await settingsService.getSettings(userId);
            return reply.send(settings);
        } catch (error) {
            console.error('Error getting settings:', error);
            return reply.status(500).send({ error: 'Failed to get settings' });
        }
    }

    /**
     * Update user settings
     * PUT /settings
     */
    async update(request: FastifyRequest<{ Body: UpdateSettingsDTO }>, reply: FastifyReply) {
        try {
            const userId = (request as any).user.id;
            const updates = request.body;
            const settings = await settingsService.updateSettings(userId, updates);
            return reply.send(settings);
        } catch (error) {
            console.error('Error updating settings:', error);
            return reply.status(500).send({ error: 'Failed to update settings' });
        }
    }
}

export const settingsController = new SettingsController();

