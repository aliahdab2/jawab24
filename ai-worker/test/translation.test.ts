import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TranslationService } from '../src/services/translation';
import OpenAI from 'openai';

vi.mock('openai');

describe('TranslationService', () => {
    let service: TranslationService;
    let mockCreate: any;

    beforeEach(() => {
        vi.clearAllMocks();

        mockCreate = vi.fn();
        (OpenAI as any).mockImplementation(() => ({
            chat: {
                completions: {
                    create: mockCreate
                }
            }
        }));

        service = new TranslationService();
    });

    it('should translate Arabic to English', async () => {
        mockCreate.mockResolvedValue({
            choices: [{ message: { content: 'Hello, how are you?' } }],
            usage: { total_tokens: 25 }
        });

        const result = await service.translate({
            text: 'مرحبا، كيف حالك؟',
            targetLanguage: 'en'
        });

        expect(result.translatedText).toBe('Hello, how are you?');
        expect(result.detectedLanguage).toBe('ar');
        expect(result.tokensUsed).toBe(25);
    });

    it('should translate English to Arabic', async () => {
        mockCreate.mockResolvedValue({
            choices: [{ message: { content: 'مرحبا' } }],
            usage: { total_tokens: 20 }
        });

        const result = await service.translate({
            text: 'Hello',
            sourceLanguage: 'en',
            targetLanguage: 'ar'
        });

        expect(result.translatedText).toBe('مرحبا');
        expect(result.tokensUsed).toBe(20);
    });

    it('should skip translation if already in target language', async () => {
        const result = await service.translate({
            text: 'Hello',
            sourceLanguage: 'en',
            targetLanguage: 'en'
        });

        expect(result.translatedText).toBe('Hello');
        expect(result.tokensUsed).toBe(0);
        expect(mockCreate).not.toHaveBeenCalled();
    });

    it('should auto-detect language', async () => {
        mockCreate.mockResolvedValue({
            choices: [{ message: { content: 'Hello' } }],
            usage: { total_tokens: 15 }
        });

        const result = await service.translate({
            text: 'مرحبا',
            sourceLanguage: 'auto',
            targetLanguage: 'en'
        });

        expect(result.detectedLanguage).toBe('ar');
    });

    it('should auto-detect language when sourceLanguage is not provided', async () => {
        mockCreate.mockResolvedValue({
            choices: [{ message: { content: 'مرحبا' } }],
            usage: { total_tokens: 18 }
        });

        const result = await service.translate({
            text: 'Hello world',
            targetLanguage: 'ar'
        });

        expect(result.detectedLanguage).toBe('en');
        expect(result.translatedText).toBe('مرحبا');
    });

    it('should throw error when not configured', async () => {
        const unconfiguredService = new (class extends TranslationService {
            constructor() {
                super();
                (this as any).client = null;
            }
        })();

        await expect(
            unconfiguredService.translate({ text: 'test', targetLanguage: 'ar' })
        ).rejects.toThrow('OPENAI_API_KEY is not configured');
    });

    it('should handle OpenAI API errors', async () => {
        mockCreate.mockRejectedValue(new Error('API rate limit exceeded'));

        await expect(
            service.translate({ text: 'test', targetLanguage: 'ar' })
        ).rejects.toThrow('Translation failed: API rate limit exceeded');
    });

    it('should detect Arabic language correctly', async () => {
        mockCreate.mockResolvedValue({
            choices: [{ message: { content: 'Hello!' } }],
            usage: { total_tokens: 12 }
        });

        const result = await service.translate({
            text: 'مرحبا!',
            sourceLanguage: 'auto',
            targetLanguage: 'en'
        });

        expect(result.detectedLanguage).toBe('ar');
    });

    it('should detect English language correctly', async () => {
        mockCreate.mockResolvedValue({
            choices: [{ message: { content: 'مرحبا!' } }],
            usage: { total_tokens: 14 }
        });

        const result = await service.translate({
            text: 'Hello!',
            sourceLanguage: 'auto',
            targetLanguage: 'ar'
        });

        expect(result.detectedLanguage).toBe('en');
    });
});
