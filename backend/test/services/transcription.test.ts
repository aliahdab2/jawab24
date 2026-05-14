import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreate = vi.fn();

class MockAPIError extends Error {
    status: number;
    constructor(status: number, message: string) {
        super(message);
        this.status = status;
    }
}

vi.mock('openai', () => {
    const MockOpenAI = vi.fn().mockImplementation(() => ({
        audio: {
            transcriptions: {
                create: mockCreate,
            },
        },
    }));
    return {
        default: MockOpenAI,
        APIError: MockAPIError,
        toFile: vi.fn().mockImplementation((buffer: Buffer, name: string) =>
            Promise.resolve({ name, size: buffer.length }),
        ),
    };
});

/** Build a Response with audio/mp4 Content-Type so the sniff-or-header guard passes. */
function audioResponse(body: Buffer | null, status = 200): Response {
    return new Response(body, {
        status,
        headers: { 'content-type': 'audio/mp4' },
    });
}

/** Build a buffer with a valid MP4 ftyp magic so sniffAudioFormat detects it. */
function mp4Buffer(extra = 'payload'): Buffer {
    return Buffer.concat([
        Buffer.from([0, 0, 0, 0x20]), // box size
        Buffer.from('ftypmp42', 'ascii'),
        Buffer.from('\0\0\0\0', 'ascii'),
        Buffer.from(extra, 'ascii'),
    ]);
}

vi.mock('../../src/config', () => ({
    config: {
        openai: { apiKey: 'test-key' },
    },
}));

vi.mock('../../src/utils/sentryHelpers', () => ({
    captureError: vi.fn(),
}));

describe('TranscriptionService', () => {
    let transcriptionService: Awaited<typeof import('../../src/services/transcription')>['transcriptionService'];

    beforeEach(async () => {
        mockCreate.mockReset();
        // Re-import to get fresh instance
        const mod = await import('../../src/services/transcription');
        transcriptionService = mod.transcriptionService;
    });

    it('should return transcribed text on success', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(audioResponse(mp4Buffer()));
        mockCreate.mockResolvedValueOnce({ text: 'كم سعر المنتج؟' });

        const result = await transcriptionService.transcribe('https://example.com/voice.mp4', 'ar');

        expect(result).toEqual({ text: 'كم سعر المنتج؟' });
        expect(mockCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                model: 'gpt-4o-mini-transcribe',
                language: 'ar',
                temperature: 0,
            }),
            expect.objectContaining({ signal: expect.any(AbortSignal) }),
        );
    });

    it('should not include a prompt parameter (avoids hallucination)', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(audioResponse(mp4Buffer()));
        mockCreate.mockResolvedValueOnce({ text: 'مرحبا' });

        await transcriptionService.transcribe('https://example.com/voice.mp4', 'ar');

        const callArgs = mockCreate.mock.calls[0][0];
        expect(callArgs.prompt).toBeUndefined();
        expect(callArgs.language).toBe('ar');
    });

    it('should omit prompt and language when no languageHint provided', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(audioResponse(mp4Buffer()));
        mockCreate.mockResolvedValueOnce({ text: 'hello' });

        await transcriptionService.transcribe('https://example.com/voice.mp4');

        const callArgs = mockCreate.mock.calls[0][0];
        expect(callArgs.language).toBeUndefined();
        expect(callArgs.prompt).toBeUndefined();
    });

    it('should return null when audio download fails', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
            new Response(null, { status: 404 }),
        );

        const result = await transcriptionService.transcribe('https://example.com/missing.mp4');

        expect(result).toBeNull();
        expect(mockCreate).not.toHaveBeenCalled();
    });

    it('should return null when transcription returns empty text', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(audioResponse(mp4Buffer()));
        mockCreate.mockResolvedValueOnce({ text: '  ' });

        const result = await transcriptionService.transcribe('https://example.com/silence.mp4');

        expect(result).toBeNull();
    });

    it('should return null when transcription API throws', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(audioResponse(mp4Buffer()));
        mockCreate.mockRejectedValueOnce(new Error('OpenAI API error'));

        const result = await transcriptionService.transcribe('https://example.com/voice.mp4');

        expect(result).toBeNull();
    });

    it('should return null when fetch throws (network error)', async () => {
        vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network error'));

        const result = await transcriptionService.transcribe('https://example.com/voice.mp4');

        expect(result).toBeNull();
    });

    it('should return null for empty audio buffer', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
            new Response(Buffer.from(''), { status: 200 }),
        );

        const result = await transcriptionService.transcribe('https://example.com/empty.mp4');

        expect(result).toBeNull();
        expect(mockCreate).not.toHaveBeenCalled();
    });

    it('should always use gpt-4o-mini-transcribe regardless of quality param', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(audioResponse(mp4Buffer()));
        mockCreate.mockResolvedValueOnce({ text: 'transcribed text' });

        await transcriptionService.transcribe('https://example.com/voice.mp4', 'ar', 'accurate');

        expect(mockCreate).toHaveBeenCalledWith(
            expect.objectContaining({ model: 'gpt-4o-mini-transcribe' }),
            expect.any(Object),
        );
    });

    it('should reject HTML error pages from CDN without calling Whisper', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
            new Response(Buffer.from('<!DOCTYPE html><html>Access denied</html>'), {
                status: 200,
                headers: { 'content-type': 'text/html' },
            }),
        );

        const result = await transcriptionService.transcribe('https://example.com/expired.mp4');

        expect(result).toBeNull();
        expect(mockCreate).not.toHaveBeenCalled();
    });

    it('should swallow OpenAI 400 errors without alerting Sentry', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(audioResponse(mp4Buffer()));
        mockCreate.mockRejectedValueOnce(new MockAPIError(400, 'Audio file might be corrupted'));

        const { captureError } = await import('../../src/utils/sentryHelpers');
        vi.mocked(captureError).mockClear();
        const result = await transcriptionService.transcribe('https://example.com/corrupt.mp4');

        expect(result).toBeNull();
        expect(captureError).not.toHaveBeenCalled();
    });

    it('should still report non-400 OpenAI errors to Sentry', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(audioResponse(mp4Buffer()));
        mockCreate.mockRejectedValueOnce(new MockAPIError(500, 'Server error'));

        const { captureError } = await import('../../src/utils/sentryHelpers');
        vi.mocked(captureError).mockClear();
        const result = await transcriptionService.transcribe('https://example.com/voice.mp4');

        expect(result).toBeNull();
        expect(captureError).toHaveBeenCalled();
    });

    it('should pick the file extension from sniffed magic bytes', async () => {
        const oggBuffer = Buffer.concat([Buffer.from('OggS', 'ascii'), Buffer.alloc(20)]);
        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
            // Wrong Content-Type on purpose — sniffing should win.
            new Response(oggBuffer, { status: 200, headers: { 'content-type': 'audio/mp4' } }),
        );
        mockCreate.mockResolvedValueOnce({ text: 'ok' });

        await transcriptionService.transcribe('https://example.com/voice');

        const { toFile } = await import('openai');
        expect(toFile).toHaveBeenCalledWith(
            expect.any(Buffer),
            'voice.ogg',
            { type: 'audio/ogg' },
        );
    });
});

describe('TranscriptionService.transcribeFromBuffer', () => {
    let transcriptionService: Awaited<typeof import('../../src/services/transcription')>['transcriptionService'];

    beforeEach(async () => {
        mockCreate.mockReset();
        const mod = await import('../../src/services/transcription');
        transcriptionService = mod.transcriptionService;
    });

    it('should transcribe audio buffer with language hint but no prompt', async () => {
        mockCreate.mockResolvedValueOnce({ text: 'عندنا توصيل مجاني' });

        const buffer = Buffer.from('fake-webm-audio');
        const result = await transcriptionService.transcribeFromBuffer(buffer, 'audio/webm', 'ar');

        expect(result).toEqual({ text: 'عندنا توصيل مجاني' });
        const callArgs = mockCreate.mock.calls[0][0];
        expect(callArgs.model).toBe('gpt-4o-mini-transcribe');
        expect(callArgs.language).toBe('ar');
        expect(callArgs.prompt).toBeUndefined();
        expect(callArgs.temperature).toBe(0);
    });

    it('should always use gpt-4o-mini-transcribe regardless of quality param', async () => {
        mockCreate.mockResolvedValueOnce({ text: 'test' });

        const buffer = Buffer.from('fake-audio');
        await transcriptionService.transcribeFromBuffer(buffer, 'audio/webm', undefined, 'fast');

        expect(mockCreate).toHaveBeenCalledWith(
            expect.objectContaining({ model: 'gpt-4o-mini-transcribe' }),
            expect.any(Object),
        );
    });

    it('should return null for empty buffer', async () => {
        const result = await transcriptionService.transcribeFromBuffer(Buffer.from(''), 'audio/webm');

        expect(result).toBeNull();
        expect(mockCreate).not.toHaveBeenCalled();
    });

    it('should return null when transcription returns empty text', async () => {
        mockCreate.mockResolvedValueOnce({ text: '   ' });

        const buffer = Buffer.from('fake-audio');
        const result = await transcriptionService.transcribeFromBuffer(buffer);

        expect(result).toBeNull();
    });

    it('should return null when API throws', async () => {
        mockCreate.mockRejectedValueOnce(new Error('API error'));

        const buffer = Buffer.from('fake-audio');
        const result = await transcriptionService.transcribeFromBuffer(buffer);

        expect(result).toBeNull();
    });

    it('should detect file extension from mimeType', async () => {
        mockCreate.mockResolvedValueOnce({ text: 'test' });

        const buffer = Buffer.from('fake-audio');
        await transcriptionService.transcribeFromBuffer(buffer, 'audio/ogg');

        const { toFile } = await import('openai');
        expect(toFile).toHaveBeenCalledWith(buffer, 'voice.ogg', { type: 'audio/ogg' });
    });
});
