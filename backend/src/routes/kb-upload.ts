import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { resolveWorkspace, requireRole } from '../middleware/workspace';
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
    type PdfVisionOptions,
} from '../services/kb/file-extractor';
import { BadRequestError } from '../services/openaiClient';
import { auth } from '../utils/swagger';
import { checkDailyCap, incrementDailyCap, dailyCapKey } from '../lib/dailyCap';
import { captureError } from '../utils/sentryHelpers';
import { createRequestLogger } from '../types/logger';

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
 *
 * admin+ only. Both callers are admin-only authoring surfaces (the Business
 * Info section editor and the catalog import sheet) and the image/scanned-PDF
 * path spends GPT Vision budget against the workspace's daily quota — so "any
 * logged-in user" let a `member` burn that quota extracting text they could
 * never save. Least privilege: the guard belongs on the endpoint, not on the
 * button that happens to be hidden today.
 */
export default async function kbUploadRoutes(fastify: FastifyInstance) {
    fastify.addHook('onRequest', authenticate);
    fastify.addHook('preHandler', resolveWorkspace);
    fastify.addHook('preHandler', requireRole('admin'));

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

            const respondWith = (result: ExtractionResult) => {
                // The per-page text layer and the page index list are Vision
                // inputs, not a client payload.
                const data: Partial<ExtractionResult> = { ...result };
                delete data.pageTexts;
                delete data.visionPages;
                request.log.info({
                    fileName,
                    method: result.method,
                    textLength: result.text.length,
                    truncated: result.truncated,
                    isScanned: result.isScanned,
                    tabular: result.tabular,
                    visionPages: result.visionPages?.length,
                    pagesRead: result.pagesRead,
                    pagesTotal: result.pagesTotal,
                }, 'KB file extraction');
                return reply.send({ success: true, data });
            };

            // Shared Vision flow: check plan + quota → extract → increment counter.
            // `fallback` is what a text-layer PDF returns whenever Vision cannot
            // run — the plan/quota gate denies it, OR the Vision call itself
            // fails: the merchant still gets their text (a table may need a
            // manual tidy) instead of an error for a document we already read.
            const runVisionExtraction = async (
                buf: Buffer,
                mime: string,
                pdfOpts?: PdfVisionOptions,
                fallback?: ExtractionResult,
            ) => {
                const visionCheck = await checkVisionAccessAndQuota(request);
                if (!visionCheck.allowed) {
                    if (fallback) {
                        request.log.info(
                            { fileName, denied: visionCheck.response.error, visionPages: pdfOpts?.pages?.length },
                            'KB Vision denied — returning the text layer',
                        );
                        return respondWith(fallback);
                    }
                    return reply.status(visionCheck.status).send(visionCheck.response);
                }
                // userId is validated inside checkVisionAccessAndQuota and carried
                // forward in the result — narrows safely without a non-null assertion.
                const { userId } = visionCheck;
                const ctx = { userId, logger: createRequestLogger(request.log) };
                let result: ExtractionResult;
                try {
                    // PDFs need per-page rasterization; images can go straight to Vision.
                    result = mime === 'application/pdf'
                        ? await extractFromPdfViaVision(buf, ctx, pdfOpts)
                        : await extractFromImage(buf, mime, ctx);
                } catch (error) {
                    if (!fallback) throw error;
                    captureError(error, 'KB Vision failed — returned the text layer instead', {
                        level: 'warning',
                        tags: { route: 'kb-upload-vision' },
                        extra: { userId, fileName, visionPages: pdfOpts?.pages?.length },
                    });
                    request.log.warn({ err: error, fileName }, 'KB Vision failed — returning the text layer');
                    return respondWith(fallback);
                }
                await incrementVisionCounter(request);
                // A text-layer PDF keeps its own verdicts on the Vision result;
                // the extractor only knows which pages it was asked to OCR.
                return respondWith(fallback ? { ...result, isScanned: false, tabular: fallback.tabular } : result);
            };

            try {
                // --- PDF ---
                if (mimeType === 'application/pdf') {
                    const pdfResult = await extractFromPDF(buffer);
                    if (pdfResult.isScanned) {
                        // No text layer anywhere: pure OCR of every page.
                        return runVisionExtraction(buffer, 'application/pdf');
                    }
                    if (pdfResult.visionPages?.length) {
                        // Text layer present, but some pages pdfjs could not
                        // read well (a scrambled table, a scanned page). Vision
                        // revisits ONLY those pages — anchored on their layer
                        // where there is one — and every other page stays the
                        // layer verbatim. Never discard the layer we already have.
                        return runVisionExtraction(
                            buffer,
                            'application/pdf',
                            { pageTexts: pdfResult.pageTexts, pages: pdfResult.visionPages },
                            pdfResult,
                        );
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
                if (error instanceof BadRequestError) {
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

export type VisionCheckResult =
    | { allowed: true; userId: string }
    | { allowed: false; status: 403 | 429 | 503; response: Record<string, unknown> };

/**
 * Check plan access (Business+) AND daily quota before calling GPT Vision.
 *
 * Exported for unit tests. On success the result carries the validated
 * `userId`, so callers consume the value via type narrowing rather than
 * re-extracting from the request with a non-null assertion.
 */
export async function checkVisionAccessAndQuota(request: FastifyRequest): Promise<VisionCheckResult> {
    const userId = (request as AuthenticatedRequest).user?.userId;
    if (!userId) {
        return { allowed: false, status: 403, response: { success: false, error: 'plan_upgrade_required', message: 'Image extraction requires the Business plan', requiredPlan: 'business' } };
    }

    const sub = await subscriptionsService.getUserSubscription(userId);
    if (!sub || !sub.plan.ecommerceEnabled) {
        return { allowed: false, status: 403, response: { success: false, error: 'plan_upgrade_required', message: 'Image extraction requires the Business plan', requiredPlan: 'business' } };
    }

    // Daily quota check via the shared daily-cap helper (same key + fail-closed
    // policy as before, now shared with image understanding).
    const planSlug = sub.plan.slug || 'business';
    const dailyLimit = VISION_DAILY_LIMITS[planSlug] ?? DEFAULT_VISION_LIMIT;

    try {
        const { allowed, used } = await checkDailyCap(dailyCapKey('vision_extract', userId), dailyLimit);
        if (!allowed) {
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
    } catch (err) {
        // Fail closed: GPT Vision is a real cost vector and quota is the only abuse guard.
        // Without Redis we cannot enforce the daily cap, so reject rather than expose
        // unbounded billing risk if Redis is down.
        captureError(err, 'kb-upload quota check failed', { tags: { route: 'kb-upload-quota' }, extra: { userId } });
        return {
            allowed: false,
            status: 503,
            response: {
                success: false,
                error: 'quota_check_unavailable',
                message: 'Image extraction is temporarily unavailable. Please try again in a moment.',
            },
        };
    }

    return { allowed: true, userId };
}

/**
 * Increment the daily Vision counter after a successful extraction.
 */
async function incrementVisionCounter(request: FastifyRequest): Promise<void> {
    const userId = (request as AuthenticatedRequest).user?.userId;
    if (!userId) return;
    await incrementDailyCap(dailyCapKey('vision_extract', userId));
}
