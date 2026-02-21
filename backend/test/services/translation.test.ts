import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';

vi.mock('axios');
vi.mock('../../src/config', () => ({
    config: {
        ai: {
            serviceUrl: 'http://localhost:3002',
        },
    },
}));

import { translateText } from '../../src/services/translation';

const mockedAxios = vi.mocked(axios, true);

describe('Translation Service', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('translateText — happy path', () => {
        it('should translate Arabic to English', async () => {
            mockedAxios.post.mockResolvedValue({
                data: {
                    translatedText: 'Welcome!',
                    detectedLanguage: 'ar',
                    tokensUsed: 15,
                },
            });

            const result = await translateText({
                text: 'مرحباً بك!',
                targetLanguage: 'en',
            });

            expect(result.translatedText).toBe('Welcome!');
            expect(result.detectedLanguage).toBe('ar');
            expect(result.tokensUsed).toBe(15);
        });

        it('should translate English to Arabic', async () => {
            mockedAxios.post.mockResolvedValue({
                data: {
                    translatedText: 'مرحباً!',
                    detectedLanguage: 'en',
                    tokensUsed: 12,
                },
            });

            const result = await translateText({
                text: 'Hello!',
                targetLanguage: 'ar',
            });

            expect(result.translatedText).toBe('مرحباً!');
            expect(result.detectedLanguage).toBe('en');
        });

        it('should send correct payload to AI worker', async () => {
            mockedAxios.post.mockResolvedValue({
                data: { translatedText: 'test', tokensUsed: 5 },
            });

            await translateText({
                text: 'Hello',
                sourceLanguage: 'en',
                targetLanguage: 'ar',
            });

            expect(mockedAxios.post).toHaveBeenCalledWith(
                'http://localhost:3002/translate',
                {
                    text: 'Hello',
                    sourceLanguage: 'en',
                    targetLanguage: 'ar',
                },
                { timeout: 30000 },
            );
        });

        it('should default sourceLanguage to auto when not provided', async () => {
            mockedAxios.post.mockResolvedValue({
                data: { translatedText: 'test', tokensUsed: 5 },
            });

            await translateText({
                text: 'Hello',
                targetLanguage: 'ar',
            });

            expect(mockedAxios.post).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ sourceLanguage: 'auto' }),
                expect.any(Object),
            );
        });
    });

    describe('translateText — error handling', () => {
        it('should throw with message on axios error with response', async () => {
            const axiosError = new Error('Request failed') as Error & {
                isAxiosError: boolean;
                response: { data: { error: string } };
            };
            axiosError.isAxiosError = true;
            axiosError.response = { data: { error: 'Service unavailable' } };
            mockedAxios.post.mockRejectedValue(axiosError);
            mockedAxios.isAxiosError.mockReturnValue(true);

            await expect(
                translateText({ text: 'Hello', targetLanguage: 'ar' })
            ).rejects.toThrow('Translation failed: Service unavailable');
        });

        it('should throw with axios message when no response data', async () => {
            const axiosError = new Error('Network Error') as Error & {
                isAxiosError: boolean;
                response: undefined;
            };
            axiosError.isAxiosError = true;
            axiosError.response = undefined;
            mockedAxios.post.mockRejectedValue(axiosError);
            mockedAxios.isAxiosError.mockReturnValue(true);

            await expect(
                translateText({ text: 'Hello', targetLanguage: 'ar' })
            ).rejects.toThrow('Translation failed: Network Error');
        });

        it('should throw with generic message for non-axios errors', async () => {
            mockedAxios.post.mockRejectedValue(new Error('Unexpected failure'));
            mockedAxios.isAxiosError.mockReturnValue(false);

            await expect(
                translateText({ text: 'Hello', targetLanguage: 'ar' })
            ).rejects.toThrow('Translation failed: Unexpected failure');
        });

        it('should handle timeout errors', async () => {
            const timeoutError = new Error('timeout of 30000ms exceeded') as Error & {
                isAxiosError: boolean;
                response: undefined;
                code: string;
            };
            timeoutError.isAxiosError = true;
            timeoutError.response = undefined;
            timeoutError.code = 'ECONNABORTED';
            mockedAxios.post.mockRejectedValue(timeoutError);
            mockedAxios.isAxiosError.mockReturnValue(true);

            await expect(
                translateText({ text: 'Hello', targetLanguage: 'ar' })
            ).rejects.toThrow('Translation failed:');
        });

        it('should handle non-Error thrown values', async () => {
            mockedAxios.post.mockRejectedValue('string error');
            mockedAxios.isAxiosError.mockReturnValue(false);

            await expect(
                translateText({ text: 'Hello', targetLanguage: 'ar' })
            ).rejects.toThrow('Translation failed: Unknown error');
        });
    });

    describe('translateText — request config', () => {
        it('should use 30 second timeout', async () => {
            mockedAxios.post.mockResolvedValue({
                data: { translatedText: 'test', tokensUsed: 5 },
            });

            await translateText({ text: 'Hello', targetLanguage: 'ar' });

            expect(mockedAxios.post).toHaveBeenCalledWith(
                expect.any(String),
                expect.any(Object),
                { timeout: 30000 },
            );
        });
    });
});
