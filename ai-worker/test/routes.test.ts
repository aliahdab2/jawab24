import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fastify, { FastifyInstance } from 'fastify';

// Mock dependencies — factories must not reference external variables (hoisting)
vi.mock('../src/services/openai', () => ({
    openaiService: {
        generateReply: vi.fn(),
        isConfigured: vi.fn(),
    },
}));

vi.mock('../src/services/translation', () => ({
    translationService: {
        translate: vi.fn(),
        isConfigured: vi.fn(),
    },
}));

vi.mock('../src/lib/sentry', () => ({
    Sentry: {
        captureException: vi.fn(),
    },
}));

vi.mock('../src/config', () => ({
    config: {
        openai: {
            model: 'gpt-4.1-mini',
            maxTokens: 300,
            temperature: 0.8,
        },
    },
}));

// Import after mocks — these are now the mocked versions
import { openaiService } from '../src/services/openai';
import { translationService } from '../src/services/translation';
import { Sentry } from '../src/lib/sentry';
import routes from '../src/routes';

const mockGenerateReply = vi.mocked(openaiService.generateReply);
const mockIsConfigured = vi.mocked(openaiService.isConfigured);
const mockTranslate = vi.mocked(translationService.translate);
const mockTranslationIsConfigured = vi.mocked(translationService.isConfigured);
const mockCaptureException = vi.mocked(Sentry.captureException);

describe('Routes', () => {
    let app: FastifyInstance;

    beforeEach(async () => {
        app = fastify({ logger: false });
        await app.register(routes);
        await app.ready();
        vi.clearAllMocks();
    });

    afterEach(async () => {
        await app.close();
    });

    // --- GET /health ---
    describe('GET /health', () => {
        it('should return 200 with service info', async () => {
            mockIsConfigured.mockReturnValue(true);
            const res = await app.inject({ method: 'GET', url: '/health' });
            expect(res.statusCode).toBe(200);
            const body = res.json();
            expect(body.status).toBe('ok');
            expect(body.service).toBe('ai-worker');
            expect(body.timestamp).toBeDefined();
        });

        it('should report openaiConfigured: true when configured', async () => {
            mockIsConfigured.mockReturnValue(true);
            const res = await app.inject({ method: 'GET', url: '/health' });
            expect(res.json().openaiConfigured).toBe(true);
        });

        it('should report openaiConfigured: false when not configured', async () => {
            mockIsConfigured.mockReturnValue(false);
            const res = await app.inject({ method: 'GET', url: '/health' });
            expect(res.json().openaiConfigured).toBe(false);
        });
    });

    // --- GET /status ---
    describe('GET /status', () => {
        it('should return 200 with service status and config', async () => {
            mockIsConfigured.mockReturnValue(true);
            const res = await app.inject({ method: 'GET', url: '/status' });
            expect(res.statusCode).toBe(200);
            const body = res.json();
            expect(body.service).toBe('ai-worker');
            expect(body.version).toBe('1.0.0');
            expect(body.openai.model).toBe('gpt-4.1-mini');
            expect(body.config.maxTokens).toBe(300);
            expect(body.config.temperature).toBe(0.8);
        });

        it('should reflect configured state of OpenAI', async () => {
            mockIsConfigured.mockReturnValue(false);
            const res = await app.inject({ method: 'GET', url: '/status' });
            expect(res.json().openai.configured).toBe(false);
        });
    });

    // --- POST /generate ---
    describe('POST /generate', () => {
        it('should return 400 when comment is missing', async () => {
            const res = await app.inject({
                method: 'POST',
                url: '/generate',
                payload: {},
            });
            expect(res.statusCode).toBe(400);
            expect(res.json().error).toBe('Comment is required');
        });

        it('should return 400 when comment is empty string', async () => {
            const res = await app.inject({
                method: 'POST',
                url: '/generate',
                payload: { comment: '' },
            });
            expect(res.statusCode).toBe(400);
        });

        it('should return 400 when comment is whitespace only', async () => {
            const res = await app.inject({
                method: 'POST',
                url: '/generate',
                payload: { comment: '   ' },
            });
            expect(res.statusCode).toBe(400);
        });

        it('should return generated reply on success', async () => {
            mockGenerateReply.mockResolvedValue({
                reply: 'Thank you!',
                language: 'en',
                intent: 'COMPLIMENT',
                confidence: 'high',
                flags: [],
            });

            const res = await app.inject({
                method: 'POST',
                url: '/generate',
                payload: { comment: 'Great product!' },
            });

            expect(res.statusCode).toBe(200);
            const body = res.json();
            expect(body.reply).toBe('Thank you!');
            expect(body.intent).toBe('COMPLIMENT');
        });

        it('should pass language and context to service', async () => {
            mockGenerateReply.mockResolvedValue({ reply: 'شكراً', language: 'ar' });

            await app.inject({
                method: 'POST',
                url: '/generate',
                payload: {
                    comment: 'منتج رائع',
                    language: 'ar',
                    context: { pageName: 'My Store', postMessage: 'New arrival' },
                },
            });

            expect(mockGenerateReply).toHaveBeenCalledWith({
                comment: 'منتج رائع',
                language: 'ar',
                context: { pageName: 'My Store', postMessage: 'New arrival' },
            });
        });

        it('should return 500 when service throws', async () => {
            mockGenerateReply.mockRejectedValue(new Error('OpenAI timeout'));

            const res = await app.inject({
                method: 'POST',
                url: '/generate',
                payload: { comment: 'Hello' },
            });

            expect(res.statusCode).toBe(500);
            expect(res.json().error).toBe('Failed to generate reply');
        });

        it('should call Sentry.captureException on error', async () => {
            const error = new Error('OpenAI timeout');
            mockGenerateReply.mockRejectedValue(error);

            await app.inject({
                method: 'POST',
                url: '/generate',
                payload: { comment: 'Hello', language: 'en' },
            });

            expect(mockCaptureException).toHaveBeenCalledWith(error, {
                extra: { comment: 'Hello', language: 'en' },
            });
        });

        it('serializes AiQuotaExhaustedError as a typed 500 the backend can reconstruct by name', async () => {
            // The whole park-and-retry chain hinges on this wire contract: a quota
            // failure must reach the backend AS a typed error, not a generic 500.
            const { AiQuotaExhaustedError } = await import('../src/lib/errors');
            mockGenerateReply.mockRejectedValue(new AiQuotaExhaustedError());

            const res = await app.inject({
                method: 'POST',
                url: '/generate',
                payload: { comment: 'بكم السعر' },
            });

            expect(res.statusCode).toBe(500);
            expect(res.json().error).toEqual({
                name: 'AiQuotaExhaustedError',
                message: 'OpenAI quota exhausted (insufficient_quota)',
            });
            // Typed AI errors are expected outcomes — must NOT spam Sentry.
            expect(mockCaptureException).not.toHaveBeenCalled();
        });
    });

    // --- POST /generate/batch ---
    describe('POST /generate/batch', () => {
        it('should return 400 when requests is missing', async () => {
            const res = await app.inject({
                method: 'POST',
                url: '/generate/batch',
                payload: {},
            });
            expect(res.statusCode).toBe(400);
            expect(res.json().error).toBe('Requests array is required');
        });

        it('should return 400 when requests is not an array', async () => {
            const res = await app.inject({
                method: 'POST',
                url: '/generate/batch',
                payload: { requests: 'not-array' },
            });
            expect(res.statusCode).toBe(400);
        });

        it('should return 400 when requests is empty array', async () => {
            const res = await app.inject({
                method: 'POST',
                url: '/generate/batch',
                payload: { requests: [] },
            });
            expect(res.statusCode).toBe(400);
        });

        it('should return 400 when requests exceeds 10', async () => {
            const requests = Array.from({ length: 11 }, (_, i) => ({ comment: `Comment ${i}` }));
            const res = await app.inject({
                method: 'POST',
                url: '/generate/batch',
                payload: { requests },
            });
            expect(res.statusCode).toBe(400);
            expect(res.json().error).toBe('Maximum 10 requests per batch');
        });

        it('should return results for valid batch', async () => {
            mockGenerateReply
                .mockResolvedValueOnce({ reply: 'Reply 1', language: 'en' })
                .mockResolvedValueOnce({ reply: 'Reply 2', language: 'en' })
                .mockResolvedValueOnce({ reply: 'Reply 3', language: 'en' });

            const res = await app.inject({
                method: 'POST',
                url: '/generate/batch',
                payload: {
                    requests: [
                        { comment: 'Comment 1' },
                        { comment: 'Comment 2' },
                        { comment: 'Comment 3' },
                    ],
                },
            });

            expect(res.statusCode).toBe(200);
            const body = res.json();
            expect(body.results).toHaveLength(3);
            expect(body.results[0].success).toBe(true);
            expect(body.results[0].reply).toBe('Reply 1');
            expect(body.results[2].reply).toBe('Reply 3');
        });

        it('should return partial results when some requests fail', async () => {
            mockGenerateReply
                .mockResolvedValueOnce({ reply: 'Reply 1', language: 'en' })
                .mockRejectedValueOnce(new Error('API error'))
                .mockResolvedValueOnce({ reply: 'Reply 3', language: 'en' });

            const res = await app.inject({
                method: 'POST',
                url: '/generate/batch',
                payload: {
                    requests: [
                        { comment: 'Comment 1' },
                        { comment: 'Comment 2' },
                        { comment: 'Comment 3' },
                    ],
                },
            });

            expect(res.statusCode).toBe(200);
            const body = res.json();
            expect(body.results).toHaveLength(3);
            expect(body.results[0].success).toBe(true);
            expect(body.results[0].reply).toBe('Reply 1');
            expect(body.results[1].success).toBe(false);
            expect(body.results[1].error).toBe('Failed to generate reply');
            expect(body.results[2].success).toBe(true);
            expect(body.results[2].reply).toBe('Reply 3');
        });

        it('should report failures to Sentry', async () => {
            mockGenerateReply.mockRejectedValue(new Error('API error'));

            await app.inject({
                method: 'POST',
                url: '/generate/batch',
                payload: {
                    requests: [{ comment: 'Hello' }],
                },
            });

            expect(mockCaptureException).toHaveBeenCalled();
        });
    });

    // --- POST /translate ---
    describe('POST /translate', () => {
        beforeEach(() => {
            vi.clearAllMocks();
        });

        it('should return 400 when text is missing', async () => {
            const res = await app.inject({
                method: 'POST',
                url: '/translate',
                payload: { targetLanguage: 'en' }
            });
            expect(res.statusCode).toBe(400);
            expect(res.json().error).toBe('Text is required');
        });

        it('should return 400 when text is empty string', async () => {
            const res = await app.inject({
                method: 'POST',
                url: '/translate',
                payload: { text: '', targetLanguage: 'en' }
            });
            expect(res.statusCode).toBe(400);
            expect(res.json().error).toBe('Text is required');
        });

        it('should return 400 when text is whitespace only', async () => {
            const res = await app.inject({
                method: 'POST',
                url: '/translate',
                payload: { text: '   ', targetLanguage: 'en' }
            });
            expect(res.statusCode).toBe(400);
            expect(res.json().error).toBe('Text is required');
        });

        it('should return 400 when targetLanguage is too short', async () => {
            const res = await app.inject({
                method: 'POST',
                url: '/translate',
                payload: { text: 'test', targetLanguage: 'x' }
            });
            expect(res.statusCode).toBe(400);
            expect(res.json().error).toBe('targetLanguage is required');
        });

        it('should return 400 when targetLanguage is missing', async () => {
            const res = await app.inject({
                method: 'POST',
                url: '/translate',
                payload: { text: 'test' }
            });
            expect(res.statusCode).toBe(400);
            expect(res.json().error).toBe('targetLanguage is required');
        });

        it('should return 400 when sourceLanguage is too short', async () => {
            const res = await app.inject({
                method: 'POST',
                url: '/translate',
                payload: { text: 'test', sourceLanguage: 'x', targetLanguage: 'en' }
            });
            expect(res.statusCode).toBe(400);
            expect(res.json().error).toBe('sourceLanguage must be a valid language code or "auto"');
        });

        it('should return 503 when translation service not configured', async () => {
            mockTranslationIsConfigured.mockReturnValue(false);
            const res = await app.inject({
                method: 'POST',
                url: '/translate',
                payload: { text: 'Hello', targetLanguage: 'ar' }
            });
            expect(res.statusCode).toBe(503);
            expect(res.json().error).toBe('Translation service not configured');
        });

        it('should translate successfully', async () => {
            mockTranslationIsConfigured.mockReturnValue(true);
            mockTranslate.mockResolvedValue({
                translatedText: 'Hello!',
                detectedLanguage: 'ar',
                tokensUsed: 20
            });

            const res = await app.inject({
                method: 'POST',
                url: '/translate',
                payload: {
                    text: 'مرحبا!',
                    targetLanguage: 'en'
                }
            });

            expect(res.statusCode).toBe(200);
            expect(res.json()).toEqual({
                translatedText: 'Hello!',
                detectedLanguage: 'ar',
                tokensUsed: 20
            });
        });

        it('should use auto as default sourceLanguage', async () => {
            mockTranslationIsConfigured.mockReturnValue(true);
            mockTranslate.mockResolvedValue({
                translatedText: 'مرحبا',
                detectedLanguage: 'en',
                tokensUsed: 18
            });

            await app.inject({
                method: 'POST',
                url: '/translate',
                payload: {
                    text: 'Hello',
                    targetLanguage: 'ar'
                }
            });

            expect(mockTranslate).toHaveBeenCalledWith({
                text: 'Hello',
                sourceLanguage: 'auto',
                targetLanguage: 'ar'
            });
        });

        it('should pass sourceLanguage when provided', async () => {
            mockTranslationIsConfigured.mockReturnValue(true);
            mockTranslate.mockResolvedValue({
                translatedText: 'Hello',
                tokensUsed: 15
            });

            await app.inject({
                method: 'POST',
                url: '/translate',
                payload: {
                    text: 'مرحبا',
                    sourceLanguage: 'ar',
                    targetLanguage: 'en'
                }
            });

            expect(mockTranslate).toHaveBeenCalledWith({
                text: 'مرحبا',
                sourceLanguage: 'ar',
                targetLanguage: 'en'
            });
        });

        it('should return 500 when service throws', async () => {
            mockTranslationIsConfigured.mockReturnValue(true);
            mockTranslate.mockRejectedValue(new Error('OpenAI timeout'));

            const res = await app.inject({
                method: 'POST',
                url: '/translate',
                payload: { text: 'Hello', targetLanguage: 'ar' }
            });

            expect(res.statusCode).toBe(500);
            expect(res.json().error).toBe('OpenAI timeout');
        });

        it('should call Sentry.captureException on error', async () => {
            mockTranslationIsConfigured.mockReturnValue(true);
            const error = new Error('API error');
            mockTranslate.mockRejectedValue(error);

            await app.inject({
                method: 'POST',
                url: '/translate',
                payload: {
                    text: 'Test',
                    sourceLanguage: 'en',
                    targetLanguage: 'ar'
                }
            });

            expect(mockCaptureException).toHaveBeenCalledWith(error, {
                extra: { sourceLanguage: 'en', targetLanguage: 'ar', textLength: 4 }
            });
        });
    });
});
