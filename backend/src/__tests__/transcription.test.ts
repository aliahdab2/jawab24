import { describe, it, expect, vi, beforeEach } from 'vitest';

// Focused coverage for the download-error handling that was refactored onto the
// shared `fetchMediaBuffer` helper. These paths all return BEFORE the OpenAI
// transcription call, so a minimal `openai` stub (constructed, never called) is
// enough. Verifies the exact prior behavior is preserved: not_ok/too_large →
// captureError + null with NO failed_before_log metric; network/timeout →
// failed_before_log + captureError + null.
const { mockFetchMediaBuffer } = vi.hoisted(() => ({ mockFetchMediaBuffer: vi.fn() }));

vi.mock('../config', () => ({ config: { openai: { apiKey: 'test-key' } } }));
vi.mock('../utils/sentryHelpers', () => ({ captureError: vi.fn() }));
vi.mock('../lib/aiMetrics', () => ({
    recordAiAttempt: vi.fn(),
    recordAiReturn: vi.fn(),
    recordAiFailedBeforeLog: vi.fn(),
}));
vi.mock('../services/aiUsageLog', () => ({ logAiUsage: vi.fn().mockResolvedValue(undefined) }));
vi.mock('openai', () => ({
    default: class {
        audio = { transcriptions: { create: vi.fn() } };
    },
    APIError: class APIErrorMock extends Error {},
    toFile: vi.fn(),
}));
vi.mock('../utils/mediaDownload', async (importActual) => {
    const actual = await importActual<typeof import('../utils/mediaDownload')>();
    return { ...actual, fetchMediaBuffer: mockFetchMediaBuffer };
});

import { transcriptionService } from '../services/transcription';
import { MediaDownloadError } from '../utils/mediaDownload';
import { captureError } from '../utils/sentryHelpers';
import { recordAiFailedBeforeLog } from '../lib/aiMetrics';
import { config } from '../config';

beforeEach(() => {
    vi.clearAllMocks();
    config.openai.apiKey = 'test-key';
});

describe('transcriptionService.transcribe — download error handling', () => {
    it('returns null + captures (no failed_before_log) on a not_ok download', async () => {
        mockFetchMediaBuffer.mockRejectedValue(new MediaDownloadError('not_ok', 'HTTP 403', 403));
        const result = await transcriptionService.transcribe('https://cdn/a.ogg', 'ar');
        expect(result).toBeNull();
        expect(captureError).toHaveBeenCalled();
        expect(recordAiFailedBeforeLog).not.toHaveBeenCalled();
    });

    it('returns null + captures (no failed_before_log) on a too_large download', async () => {
        mockFetchMediaBuffer.mockRejectedValue(new MediaDownloadError('too_large', 'too big'));
        const result = await transcriptionService.transcribe('https://cdn/a.ogg', 'ar');
        expect(result).toBeNull();
        expect(captureError).toHaveBeenCalled();
        expect(recordAiFailedBeforeLog).not.toHaveBeenCalled();
    });

    it('returns null + records failed_before_log + captures on a timeout', async () => {
        mockFetchMediaBuffer.mockRejectedValue(new MediaDownloadError('timeout', 'timed out'));
        const result = await transcriptionService.transcribe('https://cdn/a.ogg', 'ar');
        expect(result).toBeNull();
        expect(recordAiFailedBeforeLog).toHaveBeenCalledWith('transcription', expect.any(String), 'OpenAIApiError');
        expect(captureError).toHaveBeenCalled();
    });

    it('returns null + records failed_before_log on a network error', async () => {
        mockFetchMediaBuffer.mockRejectedValue(new MediaDownloadError('network', 'ECONNRESET'));
        const result = await transcriptionService.transcribe('https://cdn/a.ogg', 'ar');
        expect(result).toBeNull();
        expect(recordAiFailedBeforeLog).toHaveBeenCalled();
    });
});
