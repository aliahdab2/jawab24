import OpenAI, { toFile } from 'openai';
import { config } from '../config';
import { captureError } from '../utils/sentryHelpers';

/** Maximum time to download audio from Facebook/Instagram CDN */
const DOWNLOAD_TIMEOUT_MS = 10_000;
/** Maximum time for Whisper API transcription */
const WHISPER_TIMEOUT_MS = 15_000;
/** Maximum audio file size (10 MB) — prevents OOM from malformed responses */
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

export interface TranscriptionResult {
    text: string;
}

class TranscriptionService {
    private client: OpenAI | null = null;

    private getClient(): OpenAI | null {
        if (!this.client && config.openai.apiKey) {
            this.client = new OpenAI({ apiKey: config.openai.apiKey });
        }
        return this.client;
    }

    /**
     * Transcribe an audio file from a URL using OpenAI Whisper.
     * Returns the transcription text or null on any failure.
     *
     * @param audioUrl - Direct URL to the audio file (Facebook includes access token)
     * @param languageHint - ISO 639-1 code ('ar', 'en') to improve accuracy
     */
    async transcribe(
        audioUrl: string,
        languageHint?: string,
    ): Promise<TranscriptionResult | null> {
        const client = this.getClient();
        if (!client) return null;

        try {
            // 1. Download audio with its own timeout
            const downloadController = new AbortController();
            const downloadTimer = setTimeout(() => downloadController.abort(), DOWNLOAD_TIMEOUT_MS);

            let audioBuffer: Buffer;
            try {
                const response = await fetch(audioUrl, { signal: downloadController.signal });
                if (!response.ok) {
                    captureError(
                        new Error(`Audio download failed: ${response.status}`),
                        'Whisper audio download failed',
                        { tags: { service: 'transcription' } },
                    );
                    return null;
                }

                const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
                if (contentLength > MAX_AUDIO_BYTES) {
                    captureError(
                        new Error(`Audio too large: ${contentLength} bytes`),
                        'Whisper audio too large',
                        { tags: { service: 'transcription' } },
                    );
                    return null;
                }

                audioBuffer = Buffer.from(await response.arrayBuffer());
            } finally {
                clearTimeout(downloadTimer);
            }

            if (audioBuffer.length === 0 || audioBuffer.length > MAX_AUDIO_BYTES) return null;

            // 2. Send to Whisper API with its own timeout
            const whisperController = new AbortController();
            const whisperTimer = setTimeout(() => whisperController.abort(), WHISPER_TIMEOUT_MS);

            try {
                const file = await toFile(audioBuffer, 'voice.mp4', { type: 'audio/mp4' });
                const transcription = await client.audio.transcriptions.create({
                    file,
                    model: 'whisper-1',
                    ...(languageHint ? { language: languageHint } : {}),
                }, { signal: whisperController.signal });

                const text = transcription.text?.trim();
                if (!text) return null;

                return { text };
            } finally {
                clearTimeout(whisperTimer);
            }
        } catch (error) {
            const isTimeout = error instanceof Error && error.name === 'AbortError';
            captureError(
                error instanceof Error ? error : new Error(String(error)),
                isTimeout ? 'Whisper transcription timeout' : 'Whisper transcription failed',
                { tags: { service: 'transcription' } },
            );
            return null;
        }
    }
}

export const transcriptionService = new TranscriptionService();
