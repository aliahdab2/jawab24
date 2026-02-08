import dotenv from 'dotenv';

dotenv.config();

export const config = {
    // Server
    port: parseInt(process.env.PORT || '3002', 10),
    nodeEnv: process.env.NODE_ENV || 'development',

    // Redis (for future queue-based processing)
    redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
        password: process.env.REDIS_PASSWORD || undefined,
    },

    // OpenAI - Always use gpt-4o-mini for cost efficiency
    openai: {
        apiKey: process.env.OPENAI_API_KEY || '',
        // Fixed model - not configurable for cost control
        model: 'gpt-4o-mini',
        maxTokens: parseInt(process.env.OPENAI_MAX_TOKENS || '300', 10),
        temperature: parseFloat(process.env.OPENAI_TEMPERATURE || '0.8'),
    },

    // Queue settings
    queue: {
        name: process.env.QUEUE_NAME || 'ai:pending',
        concurrency: parseInt(process.env.QUEUE_CONCURRENCY || '5', 10),
    },
};

