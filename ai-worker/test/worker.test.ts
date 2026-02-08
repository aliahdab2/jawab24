import { describe, it, expect, vi, beforeEach } from 'vitest';

// Store the processor callback for testing
let storedProcessor: Function | null = null;

const mockWorkerInstance = {
    on: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
};

vi.mock('bullmq', () => ({
    Worker: vi.fn().mockImplementation((_name: string, processor: Function) => {
        storedProcessor = processor;
        return mockWorkerInstance;
    }),
}));

vi.mock('@jawab24/shared', () => ({
    AI_QUEUE_NAME: 'ai-generation-queue',
}));

const mockGenerateReply = vi.fn();
vi.mock('../src/services/openai', () => ({
    openaiService: {
        generateReply: mockGenerateReply,
    },
}));

const mockCaptureException = vi.fn();
vi.mock('../src/lib/sentry', () => ({
    Sentry: {
        captureException: mockCaptureException,
    },
}));

vi.mock('../src/config', () => ({
    config: {
        redis: { host: 'localhost', port: 6379, password: undefined },
        queue: { concurrency: 5 },
    },
}));

import { Worker } from 'bullmq';

describe('Worker', () => {
    let startWorker: typeof import('../src/worker').startWorker;
    let stopWorker: typeof import('../src/worker').stopWorker;
    let getWorker: typeof import('../src/worker').getWorker;

    beforeEach(async () => {
        vi.clearAllMocks();
        storedProcessor = null;
        vi.resetModules();

        // Re-apply mocks after resetModules
        vi.doMock('bullmq', () => ({
            Worker: vi.fn().mockImplementation((_name: string, processor: Function) => {
                storedProcessor = processor;
                return mockWorkerInstance;
            }),
        }));
        vi.doMock('@jawab24/shared', () => ({
            AI_QUEUE_NAME: 'ai-generation-queue',
        }));
        vi.doMock('../src/services/openai', () => ({
            openaiService: { generateReply: mockGenerateReply },
        }));
        vi.doMock('../src/lib/sentry', () => ({
            Sentry: { captureException: mockCaptureException },
        }));
        vi.doMock('../src/config', () => ({
            config: {
                redis: { host: 'localhost', port: 6379, password: undefined },
                queue: { concurrency: 5 },
            },
        }));

        const mod = await import('../src/worker');
        startWorker = mod.startWorker;
        stopWorker = mod.stopWorker;
        getWorker = mod.getWorker;
    });

    // --- Lifecycle ---
    describe('Lifecycle', () => {
        it('should start the worker and return worker instance', () => {
            const worker = startWorker();
            expect(worker).toBeDefined();
        });

        it('should create Worker with correct queue name', async () => {
            startWorker();
            const { Worker: MockWorker } = await import('bullmq');
            expect(MockWorker).toHaveBeenCalledWith(
                'ai-generation-queue',
                expect.any(Function),
                expect.any(Object)
            );
        });

        it('should use redis connection from config', async () => {
            startWorker();
            const { Worker: MockWorker } = await import('bullmq');
            const callArgs = (MockWorker as any).mock.calls[0][2];
            expect(callArgs.connection).toEqual({
                host: 'localhost',
                port: 6379,
                password: undefined,
            });
        });

        it('should use concurrency from config', async () => {
            startWorker();
            const { Worker: MockWorker } = await import('bullmq');
            const callArgs = (MockWorker as any).mock.calls[0][2];
            expect(callArgs.concurrency).toBe(5);
        });

        it('should register completed and failed event handlers', () => {
            startWorker();
            const onCalls = mockWorkerInstance.on.mock.calls.map((c: any) => c[0]);
            expect(onCalls).toContain('completed');
            expect(onCalls).toContain('failed');
        });
    });

    // --- Stop/Get ---
    describe('Stop/Get', () => {
        it('should stop the worker by calling close()', async () => {
            startWorker();
            await stopWorker();
            expect(mockWorkerInstance.close).toHaveBeenCalled();
        });

        it('should return null from getWorker() when not started', () => {
            expect(getWorker()).toBeNull();
        });

        it('should return worker instance from getWorker() when started', () => {
            startWorker();
            expect(getWorker()).not.toBeNull();
        });
    });

    // --- Job Processing ---
    describe('Job Processing', () => {
        it('should call openaiService.generateReply with job data', async () => {
            mockGenerateReply.mockResolvedValue({ reply: 'Hello!', language: 'en' });
            startWorker();

            const mockJob = {
                id: 'job-123',
                data: { comment: 'Great product!', language: 'en', context: { pageName: 'Shop' } },
            };

            await storedProcessor!(mockJob);
            expect(mockGenerateReply).toHaveBeenCalledWith({
                comment: 'Great product!',
                language: 'en',
                context: { pageName: 'Shop' },
            });
        });

        it('should return the generated result', async () => {
            const expectedResult = { reply: 'Thank you!', language: 'en', intent: 'COMPLIMENT' };
            mockGenerateReply.mockResolvedValue(expectedResult);
            startWorker();

            const result = await storedProcessor!({ id: 'job-1', data: { comment: 'Nice!' } });
            expect(result).toEqual(expectedResult);
        });

        it('should throw and call Sentry on error', async () => {
            const error = new Error('OpenAI failed');
            mockGenerateReply.mockRejectedValue(error);
            startWorker();

            const mockJob = { id: 'job-err', data: { comment: 'Hello', language: 'en' } };

            await expect(storedProcessor!(mockJob)).rejects.toThrow('OpenAI failed');
            expect(mockCaptureException).toHaveBeenCalledWith(error, {
                extra: { jobId: 'job-err', comment: 'Hello', language: 'en' },
            });
        });

        it('should log job ID on processing', async () => {
            mockGenerateReply.mockResolvedValue({ reply: 'Hi', language: 'en' });
            const mockLogger = { info: vi.fn(), error: vi.fn() };
            startWorker(mockLogger as any);

            await storedProcessor!({ id: 'job-log', data: { comment: 'Test' } });
            expect(mockLogger.info).toHaveBeenCalledWith(
                expect.objectContaining({ jobId: 'job-log' }),
                'Processing job'
            );
        });
    });
});
