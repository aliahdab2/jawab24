import dotenv from 'dotenv';
dotenv.config();

// Initialize Sentry FIRST
import { initSentry } from './lib/sentry';
import * as Sentry from '@sentry/node';
initSentry();

import { config, validateConfig } from './config';
import { buildServer } from './server';
import { startWorker, stopWorker } from './worker';

// Fail fast if config is invalid or critical env vars are missing
try {
    validateConfig();
} catch (err) {
    console.error(err instanceof Error ? err.message : err);
    Sentry.captureException(err instanceof Error ? err : new Error(String(err)));
    (async () => { await Sentry.flush(2000); process.exit(1); })();
}
if (!config.openai.apiKey) {
    console.error('FATAL: OPENAI_API_KEY environment variable is required. AI worker cannot function without it.');
    Sentry.captureMessage('FATAL: OPENAI_API_KEY not set', { level: 'fatal' });
    (async () => { await Sentry.flush(2000); process.exit(1); })();
}

let server: Awaited<ReturnType<typeof buildServer>>;

const start = async () => {
    try {
        server = await buildServer();
        await server.listen({ port: config.port, host: '0.0.0.0' });
        server.log.info(`AI Worker listening on http://0.0.0.0:${config.port}`);

        startWorker(server.log);
    } catch (err) {
        console.error('Failed to start AI Worker:', err);
        Sentry.captureException(err instanceof Error ? err : new Error('Failed to start AI Worker'));
        await Sentry.flush(2000);
        process.exit(1);
    }
};

// Graceful shutdown handling
const gracefulShutdown = async (signal: string) => {
    server?.log.info(`${signal} received, closing AI worker gracefully...`);

    try {
        await server?.close();
        await stopWorker();
        server?.log.info('AI Worker closed successfully');
        process.exit(0);
    } catch (err) {
        server?.log.error(err, 'Error during shutdown');
        process.exit(1);
    }
};

// Register shutdown handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
    server?.log.error(error, 'Uncaught Exception');
    gracefulShutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason, promise) => {
    server?.log.error({ reason, promise }, 'Unhandled Rejection');
    gracefulShutdown('UNHANDLED_REJECTION');
});

start();
