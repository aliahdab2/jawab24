import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyRequest, FastifyReply } from 'fastify';

// Mock dependencies before imports
vi.mock('../../src/services/settings', () => ({
    settingsService: {
        getSettings: vi.fn(),
        updateSettings: vi.fn(),
    },
}));

vi.mock('@jawab24/shared', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@jawab24/shared')>();
    return { ...actual, UpdateSettingsSchema: { safeParse: vi.fn() } };
});

vi.mock('../../src/utils/validation', () => ({
    validateSchema: vi.fn(),
}));

// Import controller AFTER mocks
import { settingsController } from '../../src/controllers/settings';
import { settingsService } from '../../src/services/settings';
import { validateSchema } from '../../src/utils/validation';

// Mock translation service
vi.mock('../../src/services/translation', () => ({
    translateText: vi.fn(),
}));

import { translateText } from '../../src/services/translation';

describe('SettingsController', () => {
    let mockRequest: Partial<FastifyRequest>;
    let mockReply: Partial<FastifyReply>;

    beforeEach(() => {
        vi.clearAllMocks();
        mockReply = {
            status: vi.fn().mockReturnThis(),
            send: vi.fn().mockReturnThis(),
            code: vi.fn().mockReturnThis(),
        };
        mockRequest = {
            user: { userId: 'user-123', facebookId: 'fb-123' },
            query: {},
            params: {},
            body: {},
            log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
        } as any;
    });

    // ─── get ─────────────────────────────────────────────

    describe('get()', () => {
        it('should return user settings on success', async () => {
            const settings = {
                dashboardLanguage: 'en',
                defaultReplyLanguage: 'en',
                aiEnabled: true,
                replyDelay: 0,
            };
            vi.mocked(settingsService.getSettings).mockResolvedValue(settings as any);

            await settingsController.get(mockRequest as any, mockReply as any);

            expect(settingsService.getSettings).toHaveBeenCalledWith('user-123', undefined);
            // Response spreads settings + the server capability flag (object storage off in tests).
            expect(mockReply.send).toHaveBeenCalledWith({ ...settings, triggerImagesEnabled: false });
        });

        it('should return 401 when user is not authenticated', async () => {
            (mockRequest as any).user = undefined;

            await settingsController.get(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(401);
            expect(mockReply.send).toHaveBeenCalledWith({ error: 'Unauthorized' });
        });

        it('should return 500 when service throws', async () => {
            vi.mocked(settingsService.getSettings).mockRejectedValue(new Error('DB connection failed'));

            await settingsController.get(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(500);
            expect(mockReply.send).toHaveBeenCalledWith({ error: 'Failed to get settings' });
        });
    });

    // ─── update ──────────────────────────────────────────

    describe('update()', () => {
        it('should return updated settings on success', async () => {
            const updates = { aiEnabled: false, replyDelay: 10 };
            const updatedSettings = { dashboardLanguage: 'en', aiEnabled: false, replyDelay: 10 };

            vi.mocked(validateSchema).mockReturnValue({ success: true, data: updates });
            vi.mocked(settingsService.getSettings).mockResolvedValue({ supportedLanguages: ['ar', 'en'] } as any);
            vi.mocked(settingsService.updateSettings).mockResolvedValue(updatedSettings as any);

            (mockRequest as any).body = updates;
            await settingsController.update(mockRequest as any, mockReply as any);

            expect(settingsService.updateSettings).toHaveBeenCalledWith('user-123', updates, undefined);
            expect(mockReply.send).toHaveBeenCalledWith(updatedSettings);
        });

        it('should auto-translate when updating single language in JSONB field', async () => {
            // Setup: Current settings have empty greeting. User updates 'ar'.
            const currentSettings = { 
                greetingMessageMulti: { ar: "", en: "" },
                supportedLanguages: ['ar', 'en'] 
            };
            const updates = { 
                greetingMessageMulti: { ar: "مرحبا", en: "" } // User types in Arabic
            };
            
            vi.mocked(validateSchema).mockReturnValue({ success: true, data: updates });
            vi.mocked(settingsService.getSettings).mockResolvedValue(currentSettings as any);
            vi.mocked(translateText).mockResolvedValue({ translatedText: "Hello", detectedLanguage: "ar", tokensUsed: 10 });
            vi.mocked(settingsService.updateSettings).mockImplementation(async (id, data) => data as any); // Return what was passed

            (mockRequest as any).body = updates;
            await settingsController.update(mockRequest as any, mockReply as any);

            // Expect translateText to be called with userId for cost attribution
            expect(translateText).toHaveBeenCalledWith({
                text: "مرحبا",
                sourceLanguage: "ar",
                targetLanguage: "en",
                userId: "user-123",
            });

            // Expect updateSettings to be called with enriched data
            expect(settingsService.updateSettings).toHaveBeenCalledWith('user-123', expect.objectContaining({
                greetingMessageMulti: expect.objectContaining({
                    ar: "مرحبا",
                    en: "Hello", // Auto-translated!
                    sourceLang: "ar"
                })
            }), undefined);
        });

        it('should return 400 when validation fails', async () => {
            vi.mocked(validateSchema).mockReturnValue({
                success: false,
                errors: [{ field: 'replyDelay', message: 'Must be between 0-300 seconds' }],
            });

            await settingsController.update(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(400);
            expect(mockReply.send).toHaveBeenCalledWith(
                expect.objectContaining({ error: 'Invalid request' }),
            );
        });

        it('should return 401 when user is not authenticated', async () => {
            (mockRequest as any).user = undefined;

            await settingsController.update(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(401);
            expect(mockReply.send).toHaveBeenCalledWith({ error: 'Unauthorized' });
        });

        it('should return 500 when service throws during update', async () => {
            vi.mocked(validateSchema).mockReturnValue({ success: true, data: { aiEnabled: false } });
            vi.mocked(settingsService.getSettings).mockResolvedValue({} as any);
            vi.mocked(settingsService.updateSettings).mockRejectedValue(new Error('DB write failed'));

            await settingsController.update(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(500);
            expect(mockReply.send).toHaveBeenCalledWith({ error: 'Failed to update settings' });
        });
    });
});
