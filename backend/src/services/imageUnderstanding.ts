/**
 * Customer-sent image → text description, for the DM reply pipeline.
 *
 * Mirrors `transcription.ts`: a pre-call turns a non-text attachment into text
 * that then flows through the UNCHANGED reply pipeline via `enqueueMessage`.
 * Here the attachment is an image and the pre-call is gpt-4.1-mini vision.
 *
 * The vision call goes through `makeTrackedOpenAI` so its OpenAI cost lands in
 * `ai_usage_log` (pipeline `image_understanding`) and aiMetrics automatically —
 * no manual logging. Every failure path returns `null`, and the caller falls
 * back to today's placeholder + "please type" nudge, so this can only ADD
 * capability, never regress the existing non-text behavior.
 *
 * The image bytes are held only in memory for the call and never persisted;
 * only the returned text description is stored (see nonTextHandler).
 */
import { config } from '../config';
import { captureError } from '../utils/sentryHelpers';
import { makeTrackedOpenAI, APIError } from './openaiClient';
import { sniffMimeType, VISION_MIME_TYPES } from './kb/file-extractor';
import { fetchMediaBuffer, MediaDownloadError } from '../utils/mediaDownload';
import { checkDailyCap, incrementDailyCap, dailyCapKey } from '../lib/dailyCap';

/** Max time to download the image from the FB/IG CDN (matches transcription.ts). */
const DOWNLOAD_TIMEOUT_MS = 10_000;
/** Max time for the vision call. High-detail vision is slower than Whisper's 15s. */
const VISION_TIMEOUT_MS = 20_000;
/** Max image size (5MB) — matches the KB vision extractor's cap. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** Cap the vision completion — the prompt asks for < 900 chars of description. */
const MAX_VISION_OUTPUT_TOKENS = 500;
/** Hard slice on the stored description so a runaway reply can't bloat the message row. */
const MAX_DESCRIPTION_CHARS = 1_000;

// Accepted image formats are the same set the KB vision extractor uses
// (VISION_MIME_TYPES) — reused, not redefined, so the two paths never drift.

/**
 * gpt-4.1-mini chosen over gpt-4o-mini after a measured comparison on real
 * customer images (2026-07-05): 4.1-mini gave far better Arabic OCR AND cost
 * ~3× LESS per image (gpt-4o-mini inflates images to ~33× the tokens). It is
 * also the house reply model (see DECISIONS.md D-001) and already priced in
 * config/aiPricing.ts.
 */
const MODEL_VISION = 'gpt-4.1-mini';

/**
 * Tiered daily caps per plan slug — the ONLY per-merchant bound on this cost
 * vector (there is deliberately no settings toggle; see the gate below). Small
 * on entry tiers as an upsell lever, generous higher up. Unknown slugs fall to
 * DEFAULT. Reuses the shared daily-cap helper (same mechanism as KB vision).
 */
const IMAGE_DAILY_LIMITS: Record<string, number> = {
    free: 3,
    starter: 5,
    business: 40,
    pro: 75,
    'scale-20k': 150,
    'scale-30k': 200,
};
const DEFAULT_IMAGE_LIMIT = 5;
const IMAGE_CAP_PREFIX = 'image_understanding';

/**
 * Merchants with an active top-up (pay-as-you-go) balance have already paid
 * for reply capacity beyond their plan — double their image cap too, so a
 * heavy PAYG buyer isn't throttled by the base plan number on their busiest
 * days. Still a bounded multiplier, not unlimited.
 */
const PAYG_LIMIT_MULTIPLIER = 2;

export interface ImageUnderstandingContext {
    userId: string;
    /** Internal pages.id (FK) for cost attribution. */
    pageId: string;
}

export interface ImageDescriptionResult {
    text: string;
}

/** Human-readable language name for the prompt, from an ISO 639-1 hint. */
function languageName(langHint: string): string {
    return langHint === 'ar' ? 'Arabic' : 'English';
}

/**
 * Describe an image a customer sent to a business's customer-service chat.
 * The description must let the AI answer WITHOUT seeing the image, so it
 * transcribes visible text verbatim, identifies screenshots vs physical
 * products, and — critically — describes out-of-domain images (e.g. a legal
 * form) factually instead of forcing a product interpretation, leaving the
 * reply pipeline's confidence/needs-attention guards to flag them.
 */
function buildVisionPrompt(langHint: string): string {
    const lang = languageName(langHint);
    return `You are describing an image a customer sent to a business's customer-service chat.
Write a compact description in ${lang} that lets a support agent answer without seeing the image.
1. Transcribe ALL visible text VERBATIM in its original language — Arabic stays Arabic, English stays English. Include prices, order numbers, dates, and error messages exactly as written.
2. If it is a screenshot (a chat, an order confirmation, a product page, or one of the business's own posts/ads), say so and describe what it shows.
3. If it shows a physical product or item, describe it concretely: type, color, brand, packaging, and any visible defect.
4. Do not guess or interpret — if the image is not a product question (a document, a form, an unrelated photo), just describe what it actually is. Mark unreadable text as "unreadable".
Keep the whole description under 900 characters. Output only the description, no preamble.`;
}

class ImageUnderstandingService {
    private hasKey(): boolean {
        return Boolean(config.openai.apiKey);
    }

    /**
     * Run the vision call on a base64 data URL and return the trimmed, capped
     * description, or null on empty/refused output. Cost + metrics are logged
     * automatically by the tracked client. Errors are handled by callers.
     */
    private async describe(
        dataUrl: string,
        langHint: string,
        ctx: ImageUnderstandingContext,
    ): Promise<ImageDescriptionResult | null> {
        const client = makeTrackedOpenAI(config.openai.apiKey, {
            userId: ctx.userId,
            pageId: ctx.pageId,
            pipeline: 'image_understanding',
        });

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), VISION_TIMEOUT_MS);
        try {
            const response = await client.chat.completions.create(
                {
                    model: MODEL_VISION,
                    max_tokens: MAX_VISION_OUTPUT_TOKENS,
                    messages: [
                        {
                            role: 'user',
                            content: [
                                { type: 'text', text: buildVisionPrompt(langHint) },
                                { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
                            ],
                        },
                    ],
                },
                { signal: controller.signal },
            );
            const text = response.choices[0]?.message?.content?.trim();
            if (!text) return null;
            return { text: text.slice(0, MAX_DESCRIPTION_CHARS) };
        } finally {
            clearTimeout(timer);
        }
    }

    /**
     * Describe an image fetched from a URL (Facebook/Instagram CDN links are
     * pre-authorized — no auth header, same as transcription.ts). Returns null
     * on any failure so the caller falls back to the nudge path.
     *
     * @param imageUrl - Direct CDN URL from the webhook attachment payload
     * @param langHint - ISO 639-1 code ('ar', 'en') for the description language
     */
    async describeFromUrl(
        imageUrl: string,
        langHint: string,
        ctx: ImageUnderstandingContext,
    ): Promise<ImageDescriptionResult | null> {
        if (!this.hasKey()) return null;

        let buffer: Buffer;
        try {
            ({ buffer } = await fetchMediaBuffer(imageUrl, { maxBytes: MAX_IMAGE_BYTES, timeoutMs: DOWNLOAD_TIMEOUT_MS }));
        } catch (error) {
            // Expired/blocked CDN URL or oversized image is benign and common — warn,
            // don't page. Network/timeout is unexpected — capture it.
            if (error instanceof MediaDownloadError && (error.reason === 'not_ok' || error.reason === 'too_large')) {
                console.warn('[imageUnderstanding] image download skipped', { reason: error.reason, status: error.status });
                return null;
            }
            captureError(
                error instanceof Error ? error : new Error(String(error)),
                error instanceof MediaDownloadError && error.reason === 'timeout' ? 'Image download timeout' : 'Image download failed',
                { tags: { service: 'image_understanding' } },
            );
            return null;
        }

        return this.describeBuffer(buffer, undefined, langHint, ctx);
    }

    /**
     * Describe an image from a raw buffer (WhatsApp media is downloaded by the
     * caller with the WABA bearer token, then passed here). Returns null on any
     * failure so the caller falls back to the nudge path.
     *
     * @param mimeType - Declared MIME (may carry a `;codecs` suffix); the actual
     *   bytes are re-sniffed and are authoritative.
     */
    async describeFromBuffer(
        buffer: Buffer,
        mimeType: string,
        langHint: string,
        ctx: ImageUnderstandingContext,
    ): Promise<ImageDescriptionResult | null> {
        if (!this.hasKey()) return null;
        return this.describeBuffer(buffer, mimeType, langHint, ctx);
    }

    /** Shared guards + vision call for both URL and buffer entry points. */
    private async describeBuffer(
        buffer: Buffer,
        _declaredMime: string | undefined,
        langHint: string,
        ctx: ImageUnderstandingContext,
    ): Promise<ImageDescriptionResult | null> {
        if (buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) {
            console.warn('[imageUnderstanding] image empty or too large (buffer)', { byteLength: buffer.length });
            return null;
        }

        // Magic bytes are authoritative — an expired CDN URL can return an HTML
        // error page, and clients mislabel formats. Reuse the KB sniffer.
        const sniffed = sniffMimeType(buffer);
        if (!sniffed || !VISION_MIME_TYPES.has(sniffed)) {
            console.warn('[imageUnderstanding] not a supported image', {
                sniffed,
                firstBytes: buffer.subarray(0, 16).toString('hex'),
            });
            return null;
        }

        const dataUrl = `data:${sniffed};base64,${buffer.toString('base64')}`;
        try {
            return await this.describe(dataUrl, langHint, ctx);
        } catch (error) {
            // A 400 means the image bytes are bad (unsupported/corrupt) — we
            // already fall back gracefully, so warn instead of paging Sentry.
            if (error instanceof APIError && error.status === 400) {
                console.warn('[imageUnderstanding] OpenAI 400, returning null', { message: error.message });
                return null;
            }
            const isTimeout = error instanceof Error && error.name === 'AbortError';
            captureError(
                error instanceof Error ? error : new Error(String(error)),
                isTimeout ? 'Image understanding timeout' : 'Image understanding failed',
                { tags: { service: 'image_understanding' } },
            );
            return null;
        }
    }
}

export const imageUnderstandingService = new ImageUnderstandingService();

export type ImageGateResult =
    | { allowed: true; ownerId: string }
    | { allowed: false; reason: 'env_disabled' | 'no_subscription' | 'cap_reached' | 'cap_check_failed' };

/**
 * Decide whether a customer image may be understood for this page's workspace:
 * global env kill switch → resolve the owning subscription (team-member pages
 * share the workspace owner's plan) → per-plan daily cap, DOUBLED for merchants
 * with an active top-up balance (they've already paid for extra reply capacity).
 * On any denial the caller falls back to today's placeholder + nudge, so a
 * denied gate never regresses below the pre-feature behavior. Fails CLOSED if
 * the cap check can't run (the cap is the only per-merchant bound on the cost).
 */
export async function checkImageUnderstandingGate(
    pageUserId: string,
    workspaceId: string,
): Promise<ImageGateResult> {
    // Optional chaining: if the config section is somehow absent, treat as
    // disabled (fall back to the nudge) rather than throwing into the handler.
    if (!config.imageUnderstanding?.enabled) return { allowed: false, reason: 'env_disabled' };

    try {
        // Lazy import keeps the subscriptions → db → schema graph out of the
        // module load of everything that merely imports the image describer (the
        // whole reply pipeline does). It's only pulled in when the gate runs.
        const { subscriptionsService } = await import('./subscriptions');
        const resolved = await subscriptionsService.resolveWorkspaceSubscription(pageUserId, workspaceId);
        if (!resolved) return { allowed: false, reason: 'no_subscription' };

        const { subscription, ownerId } = resolved;
        const baseLimit = IMAGE_DAILY_LIMITS[subscription.plan.slug] ?? DEFAULT_IMAGE_LIMIT;
        const topupBalance = await subscriptionsService.getTopupBalance(ownerId);
        const limit = topupBalance > 0 ? baseLimit * PAYG_LIMIT_MULTIPLIER : baseLimit;

        const { allowed } = await checkDailyCap(dailyCapKey(IMAGE_CAP_PREFIX, ownerId), limit);
        if (!allowed) return { allowed: false, reason: 'cap_reached' };

        return { allowed: true, ownerId };
    } catch (err) {
        // Never throw — a gate failure must fall back to the nudge, not drop the
        // message. Fail closed (deny) so a DB/Redis blip can't uncork uncapped cost.
        captureError(
            err instanceof Error ? err : new Error(String(err)),
            'image understanding gate failed',
            { tags: { service: 'image_understanding' }, extra: { workspaceId } },
        );
        return { allowed: false, reason: 'cap_check_failed' };
    }
}

/** Increment the daily image-understanding counter after a successful describe. */
export async function incrementImageUnderstandingCounter(ownerId: string): Promise<void> {
    await incrementDailyCap(dailyCapKey(IMAGE_CAP_PREFIX, ownerId));
}
