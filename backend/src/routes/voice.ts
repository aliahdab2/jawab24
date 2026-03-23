import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticate } from '../middleware/auth';
import { transcriptionService, MAX_AUDIO_BYTES } from '../services/transcription';
import { auth } from '../utils/swagger';

/** Base64 is ~33% larger than raw bytes */
const MAX_BASE64_LENGTH = Math.ceil(MAX_AUDIO_BYTES * 1.34);

interface TranscribeBody {
    audio: string;
    mimeType?: string;
    languageHint?: string;
    quality?: 'fast' | 'accurate';
}

/**
 * Voice Routes — KB voice input transcription
 * All routes require authentication (any logged-in user, not admin-only)
 */
export default async function voiceRoutes(fastify: FastifyInstance) {
    fastify.addHook('onRequest', authenticate);

    /**
     * POST /voice/transcribe - Transcribe audio for KB voice input
     * Body: { audio: base64, mimeType?: string, languageHint?: string, quality?: 'fast' | 'accurate' }
     * Rate limit: 10 req/min per user (each call costs ~$0.01)
     */
    fastify.post<{ Body: TranscribeBody }>(
        '/transcribe',
        {
            schema: { tags: ['Voice'], summary: 'Transcribe audio for KB voice input', security: auth },
            config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
        },
        async (request: FastifyRequest<{ Body: TranscribeBody }>, reply: FastifyReply) => {
            const { audio, mimeType = 'audio/webm', languageHint, quality = 'accurate' } = request.body;

            if (!audio) {
                return reply.status(400).send({ success: false, error: 'audio (base64) is required' });
            }

            if (audio.length > MAX_BASE64_LENGTH) {
                return reply.status(413).send({ success: false, error: 'Audio file too large (max 10 MB)' });
            }

            const audioBuffer = Buffer.from(audio, 'base64');

            if (audioBuffer.length === 0) {
                return reply.status(400).send({ success: false, error: 'Empty audio data' });
            }

            try {
                const startTime = Date.now();
                const result = await transcriptionService.transcribeFromBuffer(
                    audioBuffer,
                    mimeType,
                    languageHint,
                    quality,
                );

                if (!result) {
                    return reply.status(422).send({ success: false, error: 'Transcription failed or returned empty' });
                }

                return reply.send({
                    success: true,
                    data: {
                        text: result.text,
                        quality,
                        languageHint: languageHint || 'auto',
                        latencyMs: Date.now() - startTime,
                    },
                });
            } catch (error) {
                request.log.error(error, 'Voice transcription failed');
                return reply.status(500).send({ success: false, error: 'Transcription failed' });
            }
        }
    );
}
