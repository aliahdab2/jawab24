import { FastifyInstance } from 'fastify';
import { leadsController } from '../controllers/leads';
import { authenticate } from '../middleware/auth';
import { resolveWorkspace } from '../middleware/workspace';
import { auth } from '../utils/swagger';

export default async function leadsRoutes(fastify: FastifyInstance) {
    fastify.addHook('preHandler', authenticate);
    fastify.addHook('preHandler', resolveWorkspace);

    fastify.get('/leads', {
        schema: { tags: ['Leads'], summary: 'List leads for a page', security: auth },
    }, leadsController.getLeads.bind(leadsController));

    fastify.get('/leads/count', {
        schema: { tags: ['Leads'], summary: 'Get new leads count for a page', security: auth },
    }, leadsController.getCount.bind(leadsController));

    fastify.patch('/leads/:id/status', {
        schema: { tags: ['Leads'], summary: 'Update lead status', security: auth },
    }, leadsController.updateStatus.bind(leadsController));

    fastify.delete('/leads/:id', {
        schema: { tags: ['Leads'], summary: 'Delete a lead', security: auth },
    }, leadsController.deleteLead.bind(leadsController));
}
