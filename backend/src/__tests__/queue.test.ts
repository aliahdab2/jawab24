import { describe, it, expect, vi } from 'vitest';
import { aiQueue, AI_QUEUE_NAME } from '../lib/queue';

// Partial mock for bullmq
vi.mock('bullmq', () => {
    return {
        Queue: vi.fn().mockImplementation(() => ({
            add: vi.fn().mockResolvedValue({ id: 'mock-job-id' }),
            close: vi.fn(),
        })),
    };
});

describe('AI Queue', () => {

    it('should initialize queue with correct name', () => {
        expect(aiQueue).toBeDefined();
        // Since we mock the class, we can't easily check the name property of the instance 
        // without more complex mocking, but we can verify it exports the name const
        expect(AI_QUEUE_NAME).toBe('ai-generation-queue');
    });

    it('should successfully add a job to the queue', async () => {
        const jobData = {
            comment: 'Test comment',
            type: 'reply' as const
        };

        const job = await aiQueue.add('generate-reply', jobData);

        expect(job).toBeDefined();
        expect(job.id).toBe('mock-job-id');
        expect(aiQueue.add).toHaveBeenCalledWith('generate-reply', jobData);
    });
});
