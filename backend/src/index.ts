import fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import dotenv from 'dotenv';
import healthRoutes from './routes/health';
import authRoutes from './routes/auth';
import webhookRoutes from './routes/webhook';
import rulesRoutes from './routes/rules';
import templatesRoutes from './routes/templates';
import aiRoutes from './routes/ai';
import pagesRoutes from './routes/pages';
import postsRoutes from './routes/posts';
import commentsRoutes from './routes/comments';
import settingsRoutes from './routes/settings';
import messagesRoutes from './routes/messages';
import versionRoutes from './routes/version';

dotenv.config();

const server = fastify({
    logger: true,
});

const start = async () => {
    try {
        // Register plugins
        await server.register(cors);
        await server.register(helmet);

        // Register routes
        await server.register(healthRoutes);
        await server.register(versionRoutes);
        await server.register(authRoutes);
        await server.register(webhookRoutes);
        await server.register(rulesRoutes);
        await server.register(templatesRoutes);
        await server.register(aiRoutes);
        await server.register(pagesRoutes);
        await server.register(postsRoutes);
        await server.register(commentsRoutes);
        await server.register(settingsRoutes);
        await server.register(messagesRoutes);

        const port = parseInt(process.env.PORT || '3000', 10);
        const host = '0.0.0.0';

        await server.listen({ port, host });
        console.log(`Server listening on http://${host}:${port}`);
    } catch (err) {
        server.log.error(err);
        process.exit(1);
    }
};

start();
