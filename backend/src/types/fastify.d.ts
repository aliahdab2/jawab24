import 'fastify';

declare module 'fastify' {
    interface FastifyRequest {
        rawBody?: Buffer;
    }

    interface FastifySchema {
        tags?: string[];
        summary?: string;
        description?: string;
        security?: Array<Record<string, string[]>>;
    }
}
