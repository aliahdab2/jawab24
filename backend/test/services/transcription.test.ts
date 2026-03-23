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
    let transcriptionService: { transcribe: (url: string, lang?: string) => Promise<{ text: string } | null> };

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
});
