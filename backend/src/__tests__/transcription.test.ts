import { describe, it, expect, vi, beforeEach } from 'vitest';

// Focused coverage for the download-error handling that was refactored onto the
// shared `fetchMediaBuffer` helper. These paths all return BEFORE the OpenAI
// transcription call, so a minimal `openai` stub (constructed, never called) is
// enough. Verifies the exact prior behavior is preserved: not_ok/too_large →
// captureError + null with NO failed_before_log metric; network/timeout →
// failed_before_log + captureError + null.
const { mockFetchMediaBuffer, mockCreate } = vi.hoisted(() => ({
    mockFetchMediaBuffer: vi.fn(),
    mockCreate: vi.fn(),
}));

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
        audio = { transcriptions: { create: mockCreate } };
    },
    APIError: class APIErrorMock extends Error {},
    toFile: vi.fn(),
}));
vi.mock('../utils/mediaDownload', async (importActual) => {
    const actual = await importActual<typeof import('../utils/mediaDownload')>();
    return { ...actual, fetchMediaBuffer: mockFetchMediaBuffer };
});

import { transcriptionService, transcriptMatchesHint } from '../services/transcription';
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

// JAWAB24-BACKEND-1J: our WHISPER_TIMEOUT_MS aborted an Instagram voice note and
// the OpenAI SDK threw `Error: Request was aborted.` — the SDK sets no `name` on
// APIUserAbortError, so the old `error.name === 'AbortError'` check was DEAD: the
// timeout was counted as `OpenAIApiError` and paged as "Transcription failed".
// Detection now reads the signal we own, so these assert the classification, not
// the error's identity.
describe('transcriptionService.transcribe — OpenAI abort/timeout classification', () => {
    /** Minimal buffer that sniffs as OGG audio (>=12 bytes, 'OggS' magic). */
    const oggBuffer = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(16)]);

    beforeEach(() => {
        mockFetchMediaBuffer.mockResolvedValue({ buffer: oggBuffer, contentType: 'audio/ogg' });
    });

    it('reports our timeout as AiTimeoutError + a fingerprinted warning', async () => {
        vi.useFakeTimers();
        try {
            // Reject exactly like the SDK does on abort: a bare Error whose name is
            // "Error", never "AbortError"/"APIUserAbortError".
            mockCreate.mockImplementation((_params: unknown, opts: { signal: AbortSignal }) =>
                new Promise((_resolve, reject) => {
                    opts.signal.addEventListener('abort', () => reject(new Error('Request was aborted.')));
                }));

            const pending = transcriptionService.transcribe('https://cdn/a.ogg', 'ar');
            await vi.advanceTimersByTimeAsync(15_000);

            expect(await pending).toBeNull();
            expect(recordAiFailedBeforeLog).toHaveBeenCalledWith(
                'transcription', 'gpt-4o-mini-transcribe', 'AiTimeoutError',
            );
            expect(captureError).toHaveBeenCalledWith(
                expect.any(Error),
                'Transcription timeout',
                expect.objectContaining({
                    level: 'warning',
                    fingerprint: ['transcription-openai-timeout'],
                }),
            );
        } finally {
            vi.useRealTimers();
        }
    });

    it('still reports a non-abort API failure as OpenAIApiError at error level', async () => {
        mockCreate.mockRejectedValue(new Error('503 service unavailable'));

        const result = await transcriptionService.transcribe('https://cdn/a.ogg', 'ar');

        expect(result).toBeNull();
        expect(recordAiFailedBeforeLog).toHaveBeenCalledWith(
            'transcription', 'gpt-4o-mini-transcribe', 'OpenAIApiError',
        );
        expect(captureError).toHaveBeenCalledWith(
            expect.any(Error),
            'Transcription failed',
            { tags: { service: 'transcription' } },
        );
    });
});

// The `language` param is only a hint to gpt-4o-mini-transcribe. On short / noisy
// Arabic voice notes it still emitted Turkish, Chinese and Latin gibberish (7 of 35
// WhatsApp voice notes on one Yemeni page, 2026-08-29), and the reply pipeline then
// mirrored that text — one Turkish reply was SENT to an Arabic-speaking customer.
// A transcript that contradicts the hint is discarded so the caller takes its
// existing "transcription failed" path (the text-only nudge) instead.
describe('transcriptMatchesHint', () => {
    it('accepts Arabic under an Arabic hint', () => {
        expect(transcriptMatchesHint('كم سعر الاشتراك الشهري؟', 'ar')).toBe(true);
    });

    it('rejects Turkish / Chinese / Latin output under an Arabic hint', () => {
        expect(transcriptMatchesHint('Alıştırakstanı', 'ar')).toBe(false);
        expect(transcriptMatchesHint('好了好了好了', 'ar')).toBe(false);
        expect(transcriptMatchesHint('Tavar ma ba harijina lafari gida.', 'ar')).toBe(false);
    });

    it('accepts mixed text that carries Arabic (a brand name inside an Arabic sentence)', () => {
        expect(transcriptMatchesHint('ابغى رابط تطبيق Z NET', 'ar')).toBe(true);
    });

    it('accepts letter-free output (a card code) — there is no script to judge', () => {
        expect(transcriptMatchesHint('735803373', 'ar')).toBe(true);
        expect(transcriptMatchesHint('111 ...', 'ar')).toBe(true);
    });

    it('does not enforce a non-Arabic hint — the hint comes from the sender\'s PREVIOUS text', () => {
        expect(transcriptMatchesHint('كم السعر', 'en')).toBe(true);
        expect(transcriptMatchesHint('how much is it', 'en')).toBe(true);
        expect(transcriptMatchesHint('كم السعر', undefined)).toBe(true);
    });
});

// The script check is enforced ONLY when the caller opts in with strictLanguage —
// the DM voice handlers do (a wrong-script transcript must not drive a customer
// reply). KB voice input does NOT: its hint is the merchant's UI locale, not a
// reading of the audio, so a merchant on the Arabic UI dictating English product
// names must keep their transcript. The `undefined, undefined` before the flag are
// the _quality and logCtx positional args.
describe('transcriptionService — strictLanguage discards a script-mismatched transcript (DM path)', () => {
    const oggBuffer = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(16)]);

    beforeEach(() => {
        mockFetchMediaBuffer.mockResolvedValue({ buffer: oggBuffer, contentType: 'audio/ogg' });
    });

    it('transcribe(): Turkish text under an Arabic hint → null + one fingerprinted warning', async () => {
        mockCreate.mockResolvedValue({ text: 'Bu dağlıcağa.' });

        const result = await transcriptionService.transcribe('https://cdn/a.ogg', 'ar', undefined, undefined, true);

        expect(result).toBeNull();
        expect(captureError).toHaveBeenCalledWith(
            expect.any(Error),
            'Transcription language mismatch',
            expect.objectContaining({ level: 'warning', fingerprint: ['transcription-language-mismatch'] }),
        );
        // The call WAS billed — never a failed_before_log.
        expect(recordAiFailedBeforeLog).not.toHaveBeenCalled();
    });

    it('transcribe(): Arabic text under an Arabic hint is returned unchanged', async () => {
        mockCreate.mockResolvedValue({ text: ' كم سعر الاشتراك ' });

        expect(await transcriptionService.transcribe('https://cdn/a.ogg', 'ar', undefined, undefined, true)).toEqual({ text: 'كم سعر الاشتراك' });
        expect(captureError).not.toHaveBeenCalled();
    });

    it('transcribeFromBuffer(): the same rule on the buffer path (WhatsApp voice notes)', async () => {
        mockCreate.mockResolvedValue({ text: '好了好了好了' });

        expect(await transcriptionService.transcribeFromBuffer(oggBuffer, 'audio/ogg', 'ar', undefined, undefined, true)).toBeNull();

        mockCreate.mockResolvedValue({ text: 'ابغا افعل الاشتراك' });
        expect(await transcriptionService.transcribeFromBuffer(oggBuffer, 'audio/ogg', 'ar', undefined, undefined, true)).toEqual({ text: 'ابغا افعل الاشتراك' });
    });

    // Regression guard for the #985 review finding: without strictLanguage (the KB
    // voice-input caller), a non-Arabic transcript under an 'ar' hint is KEPT, not
    // discarded — a merchant dictating English Business Info on the Arabic UI must
    // not lose their recording, and nothing is captured to Sentry.
    it('transcribeFromBuffer(): NON-strict (KB voice) keeps a non-Arabic transcript', async () => {
        mockCreate.mockResolvedValue({ text: 'iPhone 15 Pro Max, warranty one year' });

        expect(await transcriptionService.transcribeFromBuffer(oggBuffer, 'audio/webm', 'ar')).toEqual({
            text: 'iPhone 15 Pro Max, warranty one year',
        });
        expect(captureError).not.toHaveBeenCalled();
    });

    it('transcribe(): NON-strict keeps a non-Arabic transcript too', async () => {
        mockCreate.mockResolvedValue({ text: 'Bu dağlıcağa.' });

        expect(await transcriptionService.transcribe('https://cdn/a.ogg', 'ar')).toEqual({ text: 'Bu dağlıcağa.' });
        expect(captureError).not.toHaveBeenCalled();
    });
});
