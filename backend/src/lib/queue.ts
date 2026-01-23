import { Queue } from 'bullmq';
import { config } from '../config';
import { AiGenerateJobData, AI_QUEUE_NAME } from '@jawab24/shared';
export { AI_QUEUE_NAME };

// Reuse the Redis config from our config file
const connection = {
    host: config.redis.host,
    port: parseInt(String(config.redis.port || 6379)),
    password: config.redis.password,
};

// Create the Queue instance
export const aiQueue = new Queue<AiGenerateJobData>(AI_QUEUE_NAME, {
    connection,
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: 'exponential',
            delay: 1000,
        },
        removeOnComplete: { age: 60 }, // Keep completed jobs for 60 seconds for status polling
        removeOnFail: 100, // Keep last 100 failures for debugging
    },
});
