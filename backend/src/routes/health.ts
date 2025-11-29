import { FastifyPluginAsync } from 'fastify';
import { db } from '../db';
import { sql } from 'drizzle-orm';

const healthRoutes: FastifyPluginAsync = async (fastify, opts) => {
    fastify.get('/health', async (request, reply) => {
        try {
            // Simple query to check DB connection
            await db.execute(sql`SELECT 1`);
            return { status: 'ok', database: 'connected', timestamp: new Date().toISOString() };
        } catch (error) {
            request.log.error(error);
            reply.status(503).send({ status: 'error', database: 'disconnected', error: String(error) });
        }
    });
};

export default healthRoutes;
