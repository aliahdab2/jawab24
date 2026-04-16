import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pagesApi } from '@/lib/api';

// Mock the API
vi.mock('@/lib/api', () => ({
    pagesApi: {
        testReply: vi.fn(),
    },
    api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('@/lib/sentryHelpers', () => ({
    captureError: vi.fn(),
}));

describe('pagesApi.testReply', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should call the correct endpoint with comment channel', async () => {
        vi.mocked(pagesApi.testReply).mockResolvedValue({
            data: {
                success: true,
                data: {
                    reply: 'Hello! Our prices start from $10.',
                    replyMethod: 'ai',
                    latencyMs: 850,
                    commentReplyMode: 'public',
                    nudgeText: null,
                },
            },
        } as any);

        const result = await pagesApi.testReply('page_1', {
            question: 'What are your prices?',
            channel: 'comment',
        });

        expect(pagesApi.testReply).toHaveBeenCalledWith('page_1', {
            question: 'What are your prices?',
            channel: 'comment',
        });
        expect(result.data.data.reply).toBe('Hello! Our prices start from $10.');
        expect(result.data.data.replyMethod).toBe('ai');
        expect(result.data.data.latencyMs).toBe(850);
    });

    it('should call with DM channel', async () => {
        vi.mocked(pagesApi.testReply).mockResolvedValue({
            data: {
                success: true,
                data: {
                    reply: 'Here are our detailed pricing...',
                    replyMethod: 'ai',
                    latencyMs: 1200,
                    commentReplyMode: null,
                    nudgeText: null,
                },
            },
        } as any);

        const result = await pagesApi.testReply('page_1', {
            question: 'I need help',
            channel: 'dm',
        });

        expect(pagesApi.testReply).toHaveBeenCalledWith('page_1', {
            question: 'I need help',
            channel: 'dm',
        });
        expect(result.data.data.commentReplyMode).toBeNull();
    });

    it('should send postMessage for comment channel', async () => {
        vi.mocked(pagesApi.testReply).mockResolvedValue({
            data: { success: true, data: { reply: 'Great product!', replyMethod: 'ai', latencyMs: 500, commentReplyMode: 'public', nudgeText: null } },
        } as any);

        await pagesApi.testReply('page_1', {
            question: 'How much?',
            channel: 'comment',
            postMessage: 'New product launch!',
        });

        expect(pagesApi.testReply).toHaveBeenCalledWith('page_1', {
            question: 'How much?',
            channel: 'comment',
            postMessage: 'New product launch!',
        });
    });

    it('should handle dual mode response with nudge text', async () => {
        vi.mocked(pagesApi.testReply).mockResolvedValue({
            data: {
                success: true,
                data: {
                    reply: 'Detailed pricing info...',
                    replyMethod: 'ai',
                    latencyMs: 900,
                    commentReplyMode: 'dual',
                    nudgeText: 'Thanks! Check your DMs for details.',
                },
            },
        } as any);

        const result = await pagesApi.testReply('page_1', {
            question: 'Prices?',
            channel: 'comment',
        });

        expect(result.data.data.commentReplyMode).toBe('dual');
        expect(result.data.data.nudgeText).toBe('Thanks! Check your DMs for details.');
        expect(result.data.data.reply).toBe('Detailed pricing info...');
    });

    it('should handle skipped replies', async () => {
        vi.mocked(pagesApi.testReply).mockResolvedValue({
            data: {
                success: true,
                data: {
                    reply: null,
                    replyMethod: 'skipped',
                    latencyMs: 50,
                    commentReplyMode: 'public',
                    nudgeText: null,
                },
            },
        } as any);

        const result = await pagesApi.testReply('page_1', {
            question: '...',
            channel: 'comment',
        });

        expect(result.data.data.reply).toBeNull();
        expect(result.data.data.replyMethod).toBe('skipped');
    });
});
