import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyRequest, FastifyReply } from 'fastify';

// Mock dependencies before imports
vi.mock('../../src/services/settings', () => ({
    settingsService: {
        getSettings: vi.fn(),
        updateSettings: vi.fn(),
    },
}));

vi.mock('../../src/utils/validation', () => ({
    UpdateSettingsSchema: { safeParse: vi.fn() },
    validateSchema: vi.fn(),
}));

// Import controller AFTER mocks
import { settingsController } from '../../src/controllers/settings';
import { settingsService } from '../../src/services/settings';
import { validateSchema } from '../../src/utils/validation';

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

            expect(settingsService.getSettings).toHaveBeenCalledWith('user-123');
            expect(mockReply.send).toHaveBeenCalledWith(settings);
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
            vi.mocked(settingsService.updateSettings).mockResolvedValue(updatedSettings as any);

            (mockRequest as any).body = updates;
            await settingsController.update(mockRequest as any, mockReply as any);

            expect(settingsService.updateSettings).toHaveBeenCalledWith('user-123', updates);
            expect(mockReply.send).toHaveBeenCalledWith(updatedSettings);
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
            vi.mocked(settingsService.updateSettings).mockRejectedValue(new Error('DB write failed'));

            await settingsController.update(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(500);
            expect(mockReply.send).toHaveBeenCalledWith({ error: 'Failed to update settings' });
        });
    });
});
