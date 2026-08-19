/**
 * Customer-sent image → text description, for the DM reply pipeline.
 *
 * Mirrors `transcription.ts`: a pre-call turns a non-text attachment into text
 * that then flows through the UNCHANGED reply pipeline via `enqueueMessage`.
 * Here the attachment is an image and the pre-call is gpt-4.1-mini vision.
 *
 * The vision call goes through `makeTrackedOpenAI` so its OpenAI cost lands in
 * `ai_usage_log` (pipeline `image_understanding`) and aiMetrics automatically —
 * no manual logging.
 *
 * Failures return a typed `ImageDescriptionOutcome`, never a bare null, because
 * the caller's reply depends on WHOSE fault it was: an unusable image earns the
 * "please send text instead" nudge, but a failure of ours must stay SILENT
 * rather than tell a customer we cannot read photos. See `ImageFailureReason`.
 *
 * The image bytes are held only in memory for the call and never persisted;
 * only the returned text description is stored (see nonTextHandler).
 */
import { config } from '../config';
import { captureError } from '../utils/sentryHelpers';
import { makeTrackedOpenAI, APIError } from './openaiClient';
import { sniffMimeType, VISION_MIME_TYPES } from './kb/file-extractor';
import { fetchMediaBuffer, MediaDownloadError } from '../utils/mediaDownload';
import { checkDailyCap, incrementDailyCap, dailyCapKey, claimDailyOnce } from '../lib/dailyCap';
import { visionDuration } from '../lib/metrics';
import { isTimeoutAbort } from '@jawab24/shared';

/** Max time to download the image from the FB/IG CDN (matches transcription.ts). */
const DOWNLOAD_TIMEOUT_MS = 10_000;
/**
 * Max time for the vision call. High-detail vision is slower than Whisper's 15s.
 *
 * Raised 20s → 25s on 2026-08-11 against measured production data, not intuition.
 * Over 30 days, 852 SUCCESSFUL image enrichments ran p50 7.8s / p90 12.8s /
 * **p99 19.7s** — i.e. the old 20s budget sat exactly on the 99th percentile, with
 * no headroom at all. And that sample is survivors only (`enrichment_status='done'`);
 * every call that timed out is missing from it, so the true distribution is worse.
 *
 * The failure mode this produced was bursty, which is what a deadline-on-the-cliff
 * looks like: ~1% lost on an ordinary day, then a whole cluster the moment OpenAI
 * slowed down and the distribution shifted right (11 Aug: 8 of 10 attempts lost).
 *
 * WHY 25s AND NOT MORE. This call is awaited inline while holding one of only ten
 * global webhook slots (`MAX_CONCURRENT_WEBHOOK_PROCESSING`), and vision slowdowns
 * are correlated by nature — so a longer deadline means the slow images arrive
 * together, pin every slot, and the server starts 503-ing unrelated webhooks:
 * texts, comments, WhatsApp, all merchants. 25s keeps the worst-case slot hold at
 * ~35s, close to what it has always been, while still clearing the measured p99
 * with headroom. A more generous deadline is only safe once the enrichment
 * continuation is detached from the webhook slot; the stub is already persisted
 * before vision runs, so that is feasible — but it changes a shared request path
 * and belongs in its own change.
 *
 * The real cure is making the call faster rather than the deadline longer:
 * `detail: 'high'` costs ~2,366 input tokens per image against ~85 for `low`.
 * That needs measuring on real Arabic screenshots first, since OCR needs the
 * resolution — `jawab24_vision_duration_seconds` now makes that measurable.
 */
export const VISION_TIMEOUT_MS = 25_000;

/** WABA media calls (getMediaInfo, downloadMedia) each carry this client timeout. */
const WHATSAPP_MEDIA_TIMEOUT_MS = 15_000;

/**
 * Worst-case wall time for ONE image enrichment, PER PLATFORM, exported so the
 * pipeline budgets that wait on it derive from these numbers instead of restating
 * them.
 *
 * `messageProcessor`'s attachment park (a sibling text DM waiting for a photo to
 * be read) was sized by hand against "download 10s + vision 20s"; when the vision
 * deadline moved, that budget silently became too short and a parked reply would
 * answer blind while the vision call it waited for was still legitimately running.
 * Deriving it makes the drift impossible rather than merely unlikely (Rule 14).
 *
 * Split by platform on purpose. WhatsApp is far the widest path — two WABA media
 * calls before vision even starts — and charging Facebook and Instagram customers
 * for that shape would make the majority of DMs park ~20s longer than their own
 * worst case requires, which is a latency regression on the text path (Rule 17)
 * paid to cover a channel the message isn't even on.
 */
export const WORST_CASE_ENRICHMENT_MS = DOWNLOAD_TIMEOUT_MS + VISION_TIMEOUT_MS;
export const WORST_CASE_ENRICHMENT_WHATSAPP_MS =
    2 * WHATSAPP_MEDIA_TIMEOUT_MS + VISION_TIMEOUT_MS;

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
 *
 * Exported so `planImageCapCoverage.test.ts` can assert every seeded plan slug
 * has an entry here: the `?? DEFAULT_IMAGE_LIMIT` fallback below means a plan
 * added without one silently ships a cap nobody chose, and silently is exactly
 * how it would be discovered — the merchant just stops getting images read.
 */
export const IMAGE_DAILY_LIMITS: Record<string, number> = {
    free: 3,
    // Basic sells Post Reply; its 200 Smart Replies/month (~6.7/day) are the
    // real ceiling, so 8 images/day cannot be the binding constraint. Stated
    // explicitly rather than left to DEFAULT_IMAGE_LIMIT — an unlisted slug
    // silently reads as 5, which is a limit nobody chose.
    basic: 8,
    // Raised 5 → 15 (2026-07-26). A real Starter store blows through 5 before
    // lunchtime: the first merchant to use this feature heavily hit the cap on
    // BOTH of his first two busy days (8 images each), and every image past the
    // 5th silently stopped being read. At $0.00113 per image the old number was
    // never protecting meaningful cost — total spend across all merchants since
    // launch is under $1 — it was just converting a working feature into a
    // failure the merchant could not see or explain.
    starter: 15,
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

/**
 * Why an image produced no description.
 *
 * The axis is deliberately WHOSE FAULT it is, not whether a retry might help,
 * because that is the question the caller actually has to answer: what do we
 * say to the customer?
 *
 * - `unusable_image` — the bytes are the problem (oversized, not a supported
 *   format, rejected by OpenAI as malformed). The customer can act on this, so
 *   asking them to send text instead is honest and useful.
 *
 * - `our_failure` — WE failed: `VISION_TIMEOUT_MS` fired, the network broke, the
 *   CDN link died before we fetched it (403, or a 200 carrying an HTML error
 *   page), the download arrived empty, the model came back with no text, or no
 *   API key is configured. The image was fine. Telling this customer «حالياً
 *   نستطيع الرد على الرسائل النصية والصوتية» is simply false — we read 35 photos
 *   for the same page the day before — and it makes the merchant's assistant
 *   announce a limitation to the person they are selling to.
 *
 * The deadline is referenced by NAME on purpose: an earlier version of this
 * comment hardcoded "20s" and was already wrong by the end of the same commit
 * that raised it.
 *
 * Prod 2026-08-11 is why this distinction exists as a TYPE and not a comment:
 * both cases returned `null`, so the caller could not tell them apart and sent
 * the same false message to a guest who had photographed a complaint.
 */
export type ImageFailureReason = 'unusable_image' | 'our_failure';

export type ImageDescriptionOutcome =
    | { ok: true; text: string }
    | { ok: false; reason: ImageFailureReason };

/**
 * No OpenAI key configured. Classed `our_failure` so no customer is told we
 * cannot read photos — but it must NOT be silent to us as well.
 *
 * Before this, a keyless deployment produced no reply, no Sentry event, no
 * metric and no log: every customer image on every page dropped indefinitely,
 * detectable only by a merchant complaining. A config regression should be loud
 * on our side and invisible on theirs, not the reverse. Fingerprinted so a
 * fleet-wide outage is one alertable issue, not one event per photo.
 */
function missingKeyOutcome(): ImageDescriptionOutcome {
    captureError(new Error('Image understanding called with no OpenAI API key'), 'Image understanding not configured', {
        level: 'warning',
        fingerprint: ['image-understanding-missing-key'],
        tags: { service: 'image_understanding' },
    });
    return { ok: false, reason: 'our_failure' };
}

/** Human-readable language name for the prompt, from an ISO 639-1 hint. */
function languageName(langHint: string): string {
    return langHint === 'ar' ? 'Arabic' : 'English';
}

/**
 * Outcome labels for the vision-latency histogram. Deliberately finer than
 * `ImageFailureReason`: the customer-facing decision only needs "whose fault",
 * but diagnosing a latency shift needs to separate a timeout from a 400 from an
 * empty completion.
 */
type VisionMetricOutcome = 'ok' | 'empty' | 'timeout' | 'error' | 'bad_image';

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
        controller: AbortController,
    ): Promise<ImageDescriptionResult | null> {
        const client = makeTrackedOpenAI(config.openai.apiKey, {
            userId: ctx.userId,
            pageId: ctx.pageId,
            pipeline: 'image_understanding',
        });

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
    ): Promise<ImageDescriptionOutcome> {
        if (!this.hasKey()) return missingKeyOutcome();

        let buffer: Buffer;
        try {
            ({ buffer } = await fetchMediaBuffer(imageUrl, { maxBytes: MAX_IMAGE_BYTES, timeoutMs: DOWNLOAD_TIMEOUT_MS }));
        } catch (error) {
            // Expired/blocked CDN URL or oversized image is benign and common — warn,
            // don't page. Network/timeout is unexpected — capture it.
            if (error instanceof MediaDownloadError && (error.reason === 'not_ok' || error.reason === 'too_large')) {
                console.warn('[imageUnderstanding] image download skipped', { reason: error.reason, status: error.status });
                // Oversized is genuinely the image; a dead CDN link is not — by the
                // time the URL 404s the customer has done nothing wrong and cannot
                // fix it by "sending text instead".
                return { ok: false, reason: error.reason === 'too_large' ? 'unusable_image' : 'our_failure' };
            }
            captureError(
                error instanceof Error ? error : new Error(String(error)),
                error instanceof MediaDownloadError && error.reason === 'timeout' ? 'Image download timeout' : 'Image download failed',
                { tags: { service: 'image_understanding' } },
            );
            return { ok: false, reason: 'our_failure' };
        }

        return this.describeBuffer(buffer, undefined, langHint, ctx);
    }

    /**
     * Describe an image from a raw buffer (WhatsApp media is downloaded by the
     * caller with the WABA bearer token, then passed here). Never throws — the
     * outcome carries WHY it failed so the caller can pick the right reply.
     *
     * NOTE the caller must supply real bytes: an empty buffer is reported as
     * `our_failure`, since nothing a customer does produces one.
     *
     * @param mimeType - Declared MIME (may carry a `;codecs` suffix); the actual
     *   bytes are re-sniffed and are authoritative.
     */
    async describeFromBuffer(
        buffer: Buffer,
        mimeType: string,
        langHint: string,
        ctx: ImageUnderstandingContext,
    ): Promise<ImageDescriptionOutcome> {
        if (!this.hasKey()) return missingKeyOutcome();
        return this.describeBuffer(buffer, mimeType, langHint, ctx);
    }

    /** Shared guards + vision call for both URL and buffer entry points. */
    private async describeBuffer(
        buffer: Buffer,
        _declaredMime: string | undefined,
        langHint: string,
        ctx: ImageUnderstandingContext,
    ): Promise<ImageDescriptionOutcome> {
        // Empty and oversized are NOT the same fault. A zero-byte body means the
        // download delivered nothing (CDN 200 with no content, a truncated WABA
        // fetch) — the customer's photo was fine and "resend as text" is a lie.
        // Oversized is genuinely the image, and the customer can act on it.
        if (buffer.length === 0) {
            console.warn('[imageUnderstanding] empty image buffer — treating as our failure');
            return { ok: false, reason: 'our_failure' };
        }
        if (buffer.length > MAX_IMAGE_BYTES) {
            console.warn('[imageUnderstanding] image too large (buffer)', { byteLength: buffer.length });
            return { ok: false, reason: 'unusable_image' };
        }

        // Magic bytes are authoritative — an expired CDN URL can return an HTML
        // error page, and clients mislabel formats. Reuse the KB sniffer.
        const sniffed = sniffMimeType(buffer);
        if (!sniffed || !VISION_MIME_TYPES.has(sniffed)) {
            console.warn('[imageUnderstanding] not a supported image', {
                sniffed,
                firstBytes: buffer.subarray(0, 16).toString('hex'),
            });
            // OUR failure, not the customer's — counterintuitive, so: this branch
            // is reached only AFTER a download succeeded, and the overwhelmingly
            // common cause is the one the comment above names, an expired CDN link
            // answering 200 with an HTML error page. Meta transcodes what customers
            // upload, so genuinely unsupported bytes barely reach us here. Calling
            // it `unusable_image` would send the false "resend as text" nudge to
            // someone whose photo was fine — the 2026-08-11 defect through a second
            // door, and the 403 form of the very same dead link is already
            // classified `our_failure` in describeFromUrl.
            return { ok: false, reason: 'our_failure' };
        }

        const dataUrl = `data:${sniffed};base64,${buffer.toString('base64')}`;
        // The controller is owned HERE, not in describe(), because only the catch
        // below can tell a timeout from a real failure — and the OpenAI SDK's abort
        // error is indistinguishable by name (see isTimeoutAbort).
        const controller = new AbortController();
        // prom-client's own timer idiom (same as tracing.ts) — it owns the
        // ms→seconds conversion so no call site can get it wrong.
        const endTimer = visionDuration.startTimer();
        const observe = (outcome: VisionMetricOutcome) => { endTimer({ outcome }); };
        try {
            const result = await this.describe(dataUrl, langHint, ctx, controller);
            observe(result ? 'ok' : 'empty');
            // No error, but OpenAI returned nothing usable. The image was fine —
            // this is our side coming back empty.
            return result ? { ok: true, text: result.text } : { ok: false, reason: 'our_failure' };
        } catch (error) {
            // A 400 means the image bytes are bad (unsupported/corrupt) — the one
            // OpenAI-side error that IS the image's fault, so the customer can act
            // on it. Capture as a fingerprinted WARNING (one grouped issue, alert
            // on frequency) so a spike — e.g. our own buffer handling regressing —
            // is visible without paging per event.
            if (error instanceof APIError && error.status === 400) {
                observe('bad_image');
                console.warn('[imageUnderstanding] OpenAI 400, image unusable', { message: error.message });
                captureError(error, 'Image understanding OpenAI 400', {
                    level: 'warning',
                    fingerprint: ['image-understanding-openai-400'],
                    tags: { service: 'image_understanding' },
                    extra: { message: error.message },
                });
                return { ok: false, reason: 'unusable_image' };
            }
            // Our VISION_TIMEOUT_MS fired, or the network/OpenAI broke. Either way
            // the image was readable and WE failed, so the caller must stay silent
            // rather than tell the customer we cannot read photos. One fingerprinted
            // warning to alert on frequency, not an error-level page per slow call.
            const isTimeout = isTimeoutAbort(controller.signal);
            observe(isTimeout ? 'timeout' : 'error');
            captureError(
                error instanceof Error ? error : new Error(String(error)),
                isTimeout ? 'Image understanding timeout' : 'Image understanding failed',
                isTimeout
                    ? {
                        level: 'warning',
                        fingerprint: ['image-understanding-openai-timeout'],
                        tags: { service: 'image_understanding' },
                        extra: { timeoutMs: VISION_TIMEOUT_MS },
                    }
                    : { tags: { service: 'image_understanding' } },
            );
            return { ok: false, reason: 'our_failure' };
        }
    }
}

export const imageUnderstandingService = new ImageUnderstandingService();

export type ImageGateResult =
    | { allowed: true; ownerId: string }
    // `cap_reached` is the one denial we can attribute and explain: we know the
    // owner and the limit they hit, so the caller can tell THEM (never their
    // customer). Every other denial is a technical failure with no owner story.
    | { allowed: false; reason: 'cap_reached'; ownerId: string; limit: number }
    | { allowed: false; reason: 'env_disabled' | 'no_subscription' | 'cap_check_failed' | 'subscription_inactive' };

/**
 * Decide whether a customer image may be understood for this page's workspace:
 * global env kill switch → resolve the owning subscription (team-member pages
 * share the workspace owner's plan) → THAT SUBSCRIPTION STILL ENTITLES ANYTHING
 * (`checkSubscriptionStatus`, the same predicate `canAutoReply` uses) → per-plan
 * daily cap, DOUBLED for merchants with an active top-up balance (they've
 * already paid for extra reply capacity).
 * Every denial stores the placeholder; what the CUSTOMER hears differs by reason
 * and is decided in one place — `actionForGateDenial` in nonTextHandler. `env_disabled`
 * and `no_subscription` nudge (both are true statements about a standing
 * configuration); `cap_reached` is silence + a merchant notification; and
 * `cap_check_failed` is silent, because image reading is working and only our
 * counter lookup broke. Fails CLOSED if the cap check can't run (the cap is the only
 * per-merchant bound on the cost) — but closed means silent, never a false
 * "we can only read text" to the customer.
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

        // A subscription ROW existing is not entitlement. Without this the gate
        // asked only "is there a plan?" and "is the daily cap spent?", so a
        // canceled, paused, or past-due-beyond-grace merchant kept having their
        // customers' photos read and billed to us. Measured in production
        // 2026-08-19: 288 of 1,527 image_understanding calls (19%, $0.32, 13
        // merchants, still accruing that day) came from merchants this predicate
        // denies.
        //
        // It is pure waste, not a service leak: this gate runs at INGESTION via
        // nonTextHandler, ahead of messageProcessor's `enforceAutoReplyGate`, so
        // we paid for the vision call and then refused to send the reply it was
        // for.
        //
        // `checkSubscriptionStatus` is the SAME predicate `canAutoReply` uses —
        // deliberately, so this gate can never be more permissive than the reply
        // it feeds. In particular top-up balance must NOT lift it: `canAutoReply`
        // never consults top-up (#749 documents that), and a merchant whose
        // replies are blocked gaining image reads by holding credits is exactly
        // the inconsistency this fixes. Top-up still doubles the CAP below, which
        // is a limit on an entitlement, not a grant of one.
        //
        // Costs nothing: `resolveWorkspaceSubscription` already returned the row
        // with its plan, and this is a pure function over it — no extra query.
        const statusCheck = subscriptionsService.checkSubscriptionStatus(subscription);
        if (!statusCheck.allowed) {
            return { allowed: false, reason: 'subscription_inactive' };
        }

        const baseLimit = IMAGE_DAILY_LIMITS[subscription.plan.slug] ?? DEFAULT_IMAGE_LIMIT;
        const topupBalance = await subscriptionsService.getTopupBalance(ownerId);
        const limit = topupBalance > 0 ? baseLimit * PAYG_LIMIT_MULTIPLIER : baseLimit;

        const { allowed } = await checkDailyCap(dailyCapKey(IMAGE_CAP_PREFIX, ownerId), limit);
        if (!allowed) return { allowed: false, reason: 'cap_reached', ownerId, limit };

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

/** One notification per owner per UTC day — same day boundary as the cap itself. */
const CAP_NOTICE_PREFIX = 'image_cap_notified';

/**
 * Tell the MERCHANT they have run out of daily image reads.
 *
 * This limit used to be completely invisible: past it we silently stopped
 * reading customer photos, and the only outward sign was a message to the
 * merchant's own customers claiming we cannot read images at all. The merchant
 * had no way to learn a cap existed, let alone that they had hit it.
 *
 * Fire-and-forget and deduped to once per day — a busy page can hit the cap
 * dozens of times in an evening, and this must never delay or fail the reply
 * pipeline.
 */
export async function notifyImageCapReached(ownerId: string, limit: number): Promise<void> {
    try {
        // Only the first cap hit of the day notifies (shared Redis primitive).
        if (!await claimDailyOnce(dailyCapKey(CAP_NOTICE_PREFIX, ownerId))) return;

        // Lazy import for the same reason the gate lazy-loads subscriptions:
        // the whole reply pipeline imports this module, and the notifications
        // graph should not be constructed at its load.
        const { notificationService } = await import('./notifications');
        await notificationService.sendTemplateNotification(ownerId, 'image_limit_reached', {
            limit: String(limit),
        });
    } catch (err) {
        // Never let a notification failure affect message handling.
        captureError(
            err instanceof Error ? err : new Error(String(err)),
            'image cap notification failed',
            { tags: { service: 'image_understanding' }, extra: { ownerId } },
        );
    }
}
