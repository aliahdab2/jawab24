import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreate = vi.fn();

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
        toFile: vi.fn().mockImplementation((buffer: Buffer, name: string) =>
            Promise.resolve({ name, size: buffer.length }),
        ),
    };
});

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
        const audioBuffer = Buffer.from('fake-audio-data');
        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
            new Response(audioBuffer, { status: 200 }),
        );
        mockCreate.mockResolvedValueOnce({ text: 'كم سعر المنتج؟' });

        const result = await transcriptionService.transcribe('https://example.com/voice.mp4', 'ar');

        expect(result).toEqual({ text: 'كم سعر المنتج؟' });
        expect(mockCreate).toHaveBeenCalledWith(
            expect.objectContaining({ model: 'gpt-4o-mini-transcribe', language: 'ar' }),
            expect.objectContaining({ signal: expect.any(AbortSignal) }),
        );
    });

    it('should return null when audio download fails', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
            new Response(null, { status: 404 }),
        );

        const result = await transcriptionService.transcribe('https://example.com/missing.mp4');

        expect(result).toBeNull();
        expect(mockCreate).not.toHaveBeenCalled();
    });

    it('should return null when Whisper returns empty text', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
            new Response(Buffer.from('audio'), { status: 200 }),
        );
        mockCreate.mockResolvedValueOnce({ text: '  ' });

        const result = await transcriptionService.transcribe('https://example.com/silence.mp4');

        expect(result).toBeNull();
    });

    it('should return null when Whisper API throws', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
            new Response(Buffer.from('audio'), { status: 200 }),
        );
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

    it('should use accurate model when quality is accurate', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
            new Response(Buffer.from('audio'), { status: 200 }),
        );
        mockCreate.mockResolvedValueOnce({ text: 'transcribed text' });

        await transcriptionService.transcribe('https://example.com/voice.mp4', 'ar', 'accurate');

        expect(mockCreate).toHaveBeenCalledWith(
            expect.objectContaining({ model: 'gpt-4o-transcribe' }),
            expect.any(Object),
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

    it('should transcribe audio buffer with accurate model by default', async () => {
        mockCreate.mockResolvedValueOnce({ text: 'عندنا توصيل مجاني' });

        const buffer = Buffer.from('fake-webm-audio');
        const result = await transcriptionService.transcribeFromBuffer(buffer, 'audio/webm', 'ar');

        expect(result).toEqual({ text: 'عندنا توصيل مجاني' });
        expect(mockCreate).toHaveBeenCalledWith(
            expect.objectContaining({ model: 'gpt-4o-transcribe', language: 'ar' }),
            expect.objectContaining({ signal: expect.any(AbortSignal) }),
        );
    });

    it('should use fast model when quality is fast', async () => {
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

    it('should return null when Whisper returns empty text', async () => {
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
