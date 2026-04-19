import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { subscriptionsService } from '../services/subscriptions';
import {
    extractFromPDF,
    extractFromWord,
    extractFromImage,
    extractFromPdfViaVision,
    extractFromSpreadsheet,
    bufferMatchesMime,
    SUPPORTED_MIME_TYPES,
    VISION_MIME_TYPES,
    SPREADSHEET_MIME_TYPES,
    MAX_FILE_SIZE_BYTES,
    type ExtractionResult,
} from '../services/kb/file-extractor';
import OpenAI from 'openai';
import { auth } from '../utils/swagger';
import { redis } from '../lib/redis';

/** Base64 is ~33% larger than raw bytes */
const MAX_BASE64_LENGTH = Math.ceil(MAX_FILE_SIZE_BYTES * 1.34);

/** Daily Vision extraction limits by plan slug */
const VISION_DAILY_LIMITS: Record<string, number> = {
    business: 10,
    pro: 25,
};
const DEFAULT_VISION_LIMIT = 10;

interface ExtractTextBody {
    file: string;      // base64-encoded file content
    mimeType: string;  // e.g. 'application/pdf', 'image/jpeg'
    fileName?: string; // original file name (for logging)
}

/**
 * KB File Upload Routes — extract text from PDF, Word, and images
 * All routes require authentication (any logged-in user)
 */
export default async function kbUploadRoutes(fastify: FastifyInstance) {
    fastify.addHook('onRequest', authenticate);

    /**
     * POST /kb/extract-text — Extract text from an uploaded file
     * Body: { file: base64, mimeType: string, fileName?: string }
     *
     * PDF/Word: free, unlimited (no API cost)
     * Images/scanned PDFs: Business+ only, daily quota (GPT Vision cost)
     */
    fastify.post<{ Body: ExtractTextBody }>(
        '/extract-text',
        {
            schema: {
                tags: ['Knowledge Base'],
                summary: 'Extract text from PDF, Word, or image file',
                security: auth,
            },
            config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
        },
        async (request: FastifyRequest<{ Body: ExtractTextBody }>, reply: FastifyReply) => {
            const { file, mimeType, fileName } = request.body;

            // --- Validation ---
            if (!file || !mimeType) {
                return reply.status(400).send({ success: false, error: 'file (base64) and mimeType are required' });
            }

            if (!SUPPORTED_MIME_TYPES.has(mimeType)) {
                return reply.status(400).send({
                    success: false,
                    error: 'Unsupported file type. Use PDF, Word (.docx), Excel (.xlsx), or image (jpg/png/webp)',
                });
            }

            if (file.length > MAX_BASE64_LENGTH) {
                return reply.status(413).send({ success: false, error: 'File too large (max 5 MB)' });
            }

            const buffer = Buffer.from(file, 'base64');
            if (buffer.length === 0) {
                return reply.status(400).send({ success: false, error: 'Empty file data' });
            }

            // Guard: a client-declared MIME that doesn't match the actual bytes
            // (HEIC renamed to .jpg, corrupt uploads, wrong extension) would fail
            // downstream as an opaque 500 — reject early with a 400.
            if (!bufferMatchesMime(buffer, mimeType)) {
                return reply.status(400).send({
                    success: false,
                    error: 'file_content_mismatch',
                    message: 'File contents do not match the declared type. The file may be corrupted or in an unsupported format (e.g. HEIC).',
                });
            }

            const respondWith = (result: ExtractionResult, extra?: Record<string, unknown>) => {
                const data = extra ? { ...result, ...extra } : result;
                request.log.info({
                    fileName,
                    method: result.method,
                    textLength: result.text.length,
                    truncated: result.truncated,
                    pagesTruncated: result.pagesTruncated,
                }, 'KB file extraction');
                return reply.send({ success: true, data });
            };

            // Shared Vision flow: check plan + quota → extract → increment counter
            const runVisionExtraction = async (buf: Buffer, mime: string, extra?: Record<string, unknown>) => {
                const visionCheck = await checkVisionAccessAndQuota(request);
                if (!visionCheck.allowed) {
                    return reply.status(visionCheck.status).send(visionCheck.response);
                }
                // PDFs need per-page rasterization; images can go straight to Vision.
                const result = mime === 'application/pdf'
                    ? await extractFromPdfViaVision(buf)
                    : await extractFromImage(buf, mime);
                await incrementVisionCounter(request);
                return respondWith(result, extra);
            };

            try {
                // --- PDF ---
                if (mimeType === 'application/pdf') {
                    const pdfResult = await extractFromPDF(buffer);
                    if (pdfResult.isScanned) {
                        return runVisionExtraction(buffer, 'application/pdf', { pagesTruncated: pdfResult.pagesTruncated });
                    }
                    return respondWith(pdfResult);
                }

                // --- Word (.docx) ---
                if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
                    mimeType === 'application/msword') {
                    return respondWith(await extractFromWord(buffer));
                }

                // --- Excel (.xlsx) ---
                if (SPREADSHEET_MIME_TYPES.has(mimeType)) {
                    return respondWith(await extractFromSpreadsheet(buffer));
                }

                // --- Image ---
                if (VISION_MIME_TYPES.has(mimeType)) {
                    return runVisionExtraction(buffer, mimeType);
                }

                return reply.status(400).send({ success: false, error: 'Unsupported file type' });
            } catch (error) {
                // OpenAI rejected the file content (e.g. image bytes don't match
                // a format Vision supports). Surface as 400 so the frontend can
                // show a user-facing error instead of treating it as a bug.
                if (error instanceof OpenAI.BadRequestError) {
                    request.log.warn({ err: error, fileName }, 'KB Vision rejected file');
                    return reply.status(400).send({
                        success: false,
                        error: 'file_content_mismatch',
                        message: 'The file could not be read as an image. Try converting it to JPEG, PNG, or WebP.',
                    });
                }
                request.log.error(error, 'KB file extraction failed');
                return reply.status(500).send({ success: false, error: 'Failed to extract text from file' });
            }
        },
    );
}

// --- Vision access + daily quota helpers ---

type VisionCheckResult =
    | { allowed: true }
    | { allowed: false; status: 403 | 429; response: Record<string, unknown> };

/**
 * Check plan access (Business+) AND daily quota before calling GPT Vision.
 */
async function checkVisionAccessAndQuota(request: FastifyRequest): Promise<VisionCheckResult> {
    const userId = (request as AuthenticatedRequest).user?.userId;
    if (!userId) {
        return { allowed: false, status: 403, response: { success: false, error: 'plan_upgrade_required', message: 'Image extraction requires the Business plan', requiredPlan: 'business' } };
    }

    const sub = await subscriptionsService.getUserSubscription(userId);
    if (!sub || !sub.plan.ecommerceEnabled) {
        return { allowed: false, status: 403, response: { success: false, error: 'plan_upgrade_required', message: 'Image extraction requires the Business plan', requiredPlan: 'business' } };
    }

    // Daily quota check via Redis
    const planSlug = sub.plan.slug || 'business';
    const dailyLimit = VISION_DAILY_LIMITS[planSlug] ?? DEFAULT_VISION_LIMIT;
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const redisKey = `vision_extract:${userId}:${today}`;

    try {
        const used = parseInt(await redis.get(redisKey) || '0', 10);
        if (used >= dailyLimit) {
            return {
                allowed: false,
                status: 429,
                response: {
                    success: false,
                    error: 'daily_limit_reached',
                    message: 'Daily image extraction limit reached. Try again tomorrow.',
                    limit: dailyLimit,
                    used,
                },
            };
        }
    } catch {
        // Redis down — allow (fail open to avoid blocking users)
    }

    return { allowed: true };
}

/**
 * Increment the daily Vision counter after a successful extraction.
 */
async function incrementVisionCounter(request: FastifyRequest): Promise<void> {
    const userId = (request as AuthenticatedRequest).user?.userId;
    if (!userId) return;

    const today = new Date().toISOString().slice(0, 10);
    const redisKey = `vision_extract:${userId}:${today}`;

    try {
        await redis.incr(redisKey);
        await redis.expire(redisKey, 86400); // 24h TTL
    } catch {
        // Non-critical — counter missed, user gets one extra extraction
    }
}
