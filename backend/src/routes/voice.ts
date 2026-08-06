import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { resolveWorkspace, requireRole } from '../middleware/workspace';
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
 *
 * admin+ only. Every caller is an admin-only authoring surface (the Business
 * Info section editor, a KB gap card, the single-fact sheet), each write behind
 * them is `requireRole('admin')`, and a transcription costs ~$0.01 of OpenAI
 * budget per call — so leaving this at "any logged-in user" let a workspace
 * `member` spend the merchant's AI budget on text nobody could ever save.
 * Least privilege: the guard belongs on the endpoint, not on the button.
 */
export default async function voiceRoutes(fastify: FastifyInstance) {
    fastify.addHook('onRequest', authenticate);
    fastify.addHook('preHandler', resolveWorkspace);
    fastify.addHook('preHandler', requireRole('admin'));

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
                // Attribute KB-voice transcription cost to the logged-in user (no
                // pageId — this is workspace-level KB input, not a page conversation).
                const userId = (request as AuthenticatedRequest).user?.userId;
                const result = await transcriptionService.transcribeFromBuffer(
                    audioBuffer,
                    mimeType,
                    languageHint,
                    quality,
                    userId ? { userId } : undefined,
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
