/**
 * «بوست اليوم» — AI post suggestion service (dogfood pilot).
 *
 * Generates ONE suggested social post per page per day (owner ruling
 * 2026-08-09) from the merchant's Business Info: text via the pinned default
 * chat model, an accompanying image via gpt-image-2. No publishing — the
 * merchant copies the text / downloads the image and posts manually
 * (FB_SCOPES carries no pages_manage_posts).
 *
 * Spend is bounded three ways, outermost first:
 *   1. config.postSuggestions env gate + page allowlist (default OFF),
 *   2. an ABSOLUTE dailyCap of `dailyCapPerPage` generations/day/page
 *      (owner: 3, «ليس أكثر») — the daily cron generation consumes 1 of them,
 *   3. the route's rate limit (2/min).
 *
 * The business bundle is assembled with the SAME service calls the
 * playground path uses (playgroundContext.ts) — buildCatalogPromptBlock,
 * buildFactCollectionsContext (ungated: no messageText → full live rows),
 * formatBusinessInfoPrompt — never a re-derivation of the reply pipeline.
 */
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import {
    formatBusinessInfoPrompt,
    unwrapBusinessProfile,
    whatsappNumbers,
    isRowLive,
    DEFAULT_AI_MODEL,
    type BusinessProfile,
    type StoredBusinessProfile,
    type PostSuggestionDto,
    type PostSuggestionEvent,
    type PostSuggestionPostType,
} from '@jawab24/shared';
import { db } from '../db';
import { pages, catalogItems, factCollections, factRows, postSuggestions } from '../db/schema';
import { config } from '../config';
import { makeTrackedOpenAI } from './openaiClient';
import { recordAiFailedBeforeLog } from '../lib/aiMetrics';
import { dailyCapKey, checkDailyCap, incrementDailyCap, type DailyCapStatus } from '../lib/dailyCap';
import { imageStorage } from './imageStorage';
import { composePostCard } from './imageCompose';
import { settingsService } from './settings';
import { getStoreContextForAI } from './ecommerce';
import { catalogService } from './catalog';
import { factCollectionsService } from './factCollections';
import { captureError } from '../utils/sentryHelpers';
import { noopLogger, type Logger } from '../types/logger';

// Pinned models + generation constants — a pilot's cost must be predictable,
// so nothing here resolves per user (grounding-verifier posture).
const POST_TEXT_MODEL = DEFAULT_AI_MODEL;
// gpt-image-2 at LOW: owner ruling 2026-08-09 (superseding the earlier medium
// ruling the same day — «لازم ما تزيد التكلفة الشهرية») — ~$0.006/image keeps
// the ABSOLUTE worst case (3/day × 30) under $0.55/month/page. If low-tier
// images measure as not-postable in the pilot, the levers are: quality
// 'medium' (~$0.05, 8×), lazy generate-on-open, or satori/sharp brand
// templates. 'gpt-image-1-mini' stays the latency fallback (priced).
const POST_IMAGE_MODEL = 'gpt-image-2';
const POST_IMAGE_QUALITY = 'low' as const;
const POST_IMAGE_SIZE = '1024x1024' as const;
const TEXT_TIMEOUT_MS = 20_000;
const IMAGE_TIMEOUT_MS = 35_000; // frontend LONG_RUNNING_TIMEOUT is 60s total
const KB_PROMPT_MAX_CHARS = 4_000;
const DAILY_CAP_PREFIX = 'post_suggest';
/** Cron waste guard: stop pre-generating after this many consecutive unopened cron suggestions. */
const CRON_UNOPENED_STREAK = 3;

let logger: Logger = noopLogger;
export function setPostSuggestionsLogger(l: Logger): void { logger = l; }

/**
 * Whether the feature is live for this page. Pure and exported so the gate is
 * unit-testable on its own (same posture as shouldVerifyGrounding). Empty
 * allowlist = fleet-wide once enabled; non-empty = only those pages.
 */
export function isPostSuggestionsEnabledForPage(pageId: string): boolean {
    if (!config.postSuggestions?.enabled) return false;
    const allowed = config.postSuggestions.pageIds;
    if (allowed && allowed.length > 0 && !allowed.includes(pageId)) return false;
    return true;
}

/**
 * Whether the CRON may pre-generate for this page. Stricter than the endpoint
 * gate on purpose: pre-generation is spend no user asked for, so an empty
 * allowlist means the cron does NOTHING (while the endpoint keeps the
 * fleet-wide-once-enabled semantics).
 */
export function isCronEligiblePage(pageId: string): boolean {
    if (!config.postSuggestions?.enabled) return false;
    const allowed = config.postSuggestions.pageIds;
    return allowed.length > 0 && allowed.includes(pageId);
}

/**
 * Deterministic contact footer (address / phone / WhatsApp) from the
 * merchant-confirmed profile half. Pure and exported for direct testing —
 * a model must never write these (a mangled digit is a lost sale), so the
 * suffix is composed here and appended after generation (D-047 posture).
 */
export function buildContactSuffix(merchant: BusinessProfile | null | undefined): string | undefined {
    if (!merchant) return undefined;
    const lines: string[] = [];
    const address = [merchant.address, merchant.city].filter(Boolean).join('، ');
    if (address) lines.push(`📍 ${address}`);
    const phone = merchant.phones?.[0] || merchant.phone;
    if (phone) lines.push(`📞 ${phone}`);
    // whatsappNumbers is THE reader of the field's legacy string|array dual shape.
    const whatsapp = whatsappNumbers(merchant)[0];
    if (whatsapp && whatsapp !== phone) {
        lines.push(`💬 واتساب: ${whatsapp}`);
    }
    return lines.length > 0 ? lines.join('\n') : undefined;
}

export type GenerateFailure =
    | { ok: false; reason: 'gated' }
    | { ok: false; reason: 'daily_cap'; cap: DailyCapStatus }
    | { ok: false; reason: 'cap_check_unavailable' }
    | { ok: false; reason: 'page_not_found' }
    | { ok: false; reason: 'generation_failed' };

export type GenerateResult =
    | { ok: true; suggestion: PostSuggestionDto; remainingToday: number; imageDegraded?: 'image_failed' | 'storage_off' }
    | GenerateFailure;

interface PageBundle {
    pageId: string;
    userId: string;
    workspaceId: string;
    pageName: string;
    /** Page avatar for the corner logo badge (best-effort branding). */
    logoUrl?: string;
    /**
     * Deterministic contact footer (address / phone / WhatsApp) composed in
     * CODE from the merchant-confirmed profile — never model-written, so a
     * digit can never be mangled (D-047 posture: decidable by code → code).
     */
    contactSuffix?: string;
    businessInfoBlock?: string;
    knowledgeBase?: string;
    productCatalog?: string;
    factCollectionsBlock?: string;
    brandVoiceNotes?: string;
    category?: string;
    hasHours: boolean;
    hasCatalog: boolean;
    hasLiveDatedRow: boolean;
}

function todayIso(): string {
    return new Date().toISOString().slice(0, 10);
}

/**
 * Assemble everything the text prompt needs, using the same building blocks
 * as playgroundContext.ts. Returns null when the page doesn't exist in this
 * workspace (caller 404s) or has no owner to bill.
 */
async function buildPageBundle(workspaceId: string, pageId: string): Promise<PageBundle | null> {
    const [page] = await db.select({
        id: pages.id,
        name: pages.name,
        userId: pages.userId,
        workspaceId: pages.workspaceId,
        knowledgeBase: pages.knowledgeBase,
        businessProfile: pages.businessProfile,
        ecommerceStoreId: pages.ecommerceStoreId,
        instagramProfilePicUrl: pages.instagramProfilePicUrl,
        facebookPageId: pages.facebookPageId,
    }).from(pages).where(and(eq(pages.id, pageId), eq(pages.workspaceId, workspaceId))).limit(1);
    if (!page || !page.userId || !page.workspaceId) return null;

    const { merchant, merchantProvenance } = unwrapBusinessProfile(page.businessProfile as StoredBusinessProfile);
    const businessInfoBlock = formatBusinessInfoPrompt(merchant ?? null, merchantProvenance) || undefined;
    const hasHours = Boolean(merchant?.hours && Object.keys(merchant.hours).length > 0);
    const category = merchant?.category || undefined;

    const contactSuffix = buildContactSuffix(merchant);

    let productCatalog: string | undefined;
    if (page.ecommerceStoreId) {
        try {
            productCatalog = (await getStoreContextForAI(page.ecommerceStoreId)).productCatalog;
        } catch (err) {
            captureError(err, 'Post suggestion: store context failed', { level: 'warning', tags: { service: 'post-suggestions' }, extra: { pageId } });
        }
    } else {
        try {
            productCatalog = await catalogService.buildCatalogPromptBlock(pageId);
        } catch (err) {
            captureError(err, 'Post suggestion: catalog block failed', { level: 'warning', tags: { service: 'post-suggestions' }, extra: { pageId } });
        }
    }

    // Ungated on purpose: no messageText → every live row. A post generator has
    // no customer message to gate on; it may draw on any confirmed fact.
    let factCollectionsBlock: string | undefined;
    try {
        factCollectionsBlock = (await factCollectionsService.buildFactCollectionsContext(pageId)).block;
    } catch (err) {
        captureError(err, 'Post suggestion: fact collections block failed', { level: 'warning', tags: { service: 'post-suggestions' }, extra: { pageId } });
    }

    let brandVoiceNotes: string | undefined;
    try {
        brandVoiceNotes = (await settingsService.getSettings(page.userId)).brandVoiceNotes || undefined;
    } catch {
        // Non-critical — the post falls back to a neutral merchant voice.
    }

    const today = todayIso();
    const hasCatalog = Boolean(productCatalog && productCatalog.trim().length > 0);
    const hasLiveDatedRow = await pageHasLiveDatedRow(pageId, today);

    // Logo for the corner badge: the stored IG avatar when present, else the
    // public Graph picture redirect (works tokenless for most pages; the
    // overlay is best-effort either way).
    const logoUrl = page.instagramProfilePicUrl
        || (page.facebookPageId ? `https://graph.facebook.com/${page.facebookPageId}/picture?type=large&width=200&height=200` : undefined);

    return {
        pageId,
        userId: page.userId,
        workspaceId: page.workspaceId,
        pageName: page.name || '',
        logoUrl,
        businessInfoBlock,
        knowledgeBase: page.knowledgeBase?.slice(0, KB_PROMPT_MAX_CHARS) || undefined,
        productCatalog,
        factCollectionsBlock,
        brandVoiceNotes,
        category,
        contactSuffix,
        hasHours,
        hasCatalog,
        hasLiveDatedRow,
    };
}

/**
 * True when the page has a dated offering that is live today — a catalog item
 * whose end date hasn't passed (catalog liveness rule), or a fact row that
 * `isRowLive` accepts AND that carries a date at all (D-057: the shared
 * predicate is the ONLY copy of that rule — never re-derive it here).
 */
async function pageHasLiveDatedRow(pageId: string, today: string): Promise<boolean> {
    const datedItems = await db.select({ startsAt: catalogItems.startsAt, endsAt: catalogItems.endsAt })
        .from(catalogItems)
        .where(and(eq(catalogItems.pageId, pageId), eq(catalogItems.isAvailable, true)))
        .limit(300);
    if (datedItems.some(i => (i.startsAt || i.endsAt) && (!i.endsAt || i.endsAt >= today))) return true;

    const collections = await db.select({ id: factCollections.id })
        .from(factCollections).where(eq(factCollections.pageId, pageId));
    if (collections.length === 0) return false;
    const rows = await db.select({ startsAt: factRows.startsAt, endsAt: factRows.endsAt })
        .from(factRows)
        .where(inArray(factRows.collectionId, collections.map(c => c.id)))
        .limit(1000);
    return rows.some(r => (r.startsAt || r.endsAt) && isRowLive(r, today));
}

/**
 * Deterministic post-type picker — no AI call. Candidates come from what the
 * page actually has; the previous suggestion's type is excluded when there is
 * a choice, so consecutive days vary.
 */
export function pickPostType(
    bundle: Pick<PageBundle, 'hasLiveDatedRow' | 'hasCatalog' | 'hasHours' | 'knowledgeBase'>,
    previousType: string | null,
): PostSuggestionPostType {
    const candidates: PostSuggestionPostType[] = [];
    if (bundle.hasLiveDatedRow) candidates.push('promo');
    if (bundle.hasCatalog) candidates.push('product_spotlight');
    if (bundle.knowledgeBase) candidates.push('faq_tip');
    if (bundle.hasHours) candidates.push('hours_reminder');
    if (candidates.length === 0) return 'general';
    const varied = candidates.filter(c => c !== previousType);
    return (varied.length > 0 ? varied : candidates)[0];
}

// Per-type CRAFT direction — what a senior copywriter would do differently
// for each angle, not just what to talk about.
const POST_TYPE_INSTRUCTIONS: Record<PostSuggestionPostType, string> = {
    promo: 'ONE currently-running dated offer from the facts above. Lead with the concrete gain, make its REAL end/start date the urgency (never an invented deadline), name the real price.',
    product_spotlight: 'ONE product/service from the catalog above. Open on the customer problem or craving it answers, add one sensory or concrete detail, then its real price.',
    faq_tip: 'ONE question customers genuinely ask (visible in the knowledge above). Hook with the question itself, answer it crisply — position the business as the expert neighbor, not a salesman.',
    hours_reminder: 'When and how to reach the business, framed as helpfulness ("we are here when you need us"), from the facts above only.',
    general: 'A warm engagement post: one relatable line about what the business does for its customers, then invite them to message with their questions or orders.',
};

interface GeneratedText {
    text: string;
    imageBrief: string;
    /** 2–5 Arabic words the compositor typesets ON the image (we render it — never the image model). */
    headline: string;
}

function buildTextPrompt(bundle: PageBundle, postType: PostSuggestionPostType, today: string): string {
    const blocks: string[] = [];
    if (bundle.businessInfoBlock) blocks.push(`<business_info>\n${bundle.businessInfoBlock}\n</business_info>`);
    if (bundle.productCatalog) blocks.push(`<product_catalog>\n${bundle.productCatalog}\n</product_catalog>`);
    if (bundle.factCollectionsBlock) blocks.push(`<business_lists>\n${bundle.factCollectionsBlock}\n</business_lists>`);
    if (bundle.knowledgeBase) blocks.push(`<business_knowledge>\n${bundle.knowledgeBase}\n</business_knowledge>`);
    if (bundle.brandVoiceNotes) blocks.push(`<brand_voice>\n${bundle.brandVoiceNotes}\n</brand_voice>`);

    return `You are the senior Arabic social-media copywriter at a top marketing agency. Write ONE organic post for the business "${bundle.pageName}" to publish on its Facebook/Instagram page today (${today}).

${blocks.join('\n\n')}

Today's angle: ${postType} — ${POST_TYPE_INSTRUCTIONS[postType]}

CRAFT — how professionals write feed posts:
- Line 1 is the HOOK: a question, a bold benefit, or a striking concrete detail that stops the scroll. Never open with the business name, a greeting, or "نقدم لكم".
- Body: 2–4 SHORT lines, one idea per line, a blank line between thought groups. Concrete beats generic — name the real product, the real price, the real date from the data.
- Close with ONE imperative call-to-action line (راسلنا / اطلب الآن / زورونا).
- Emojis: 2–5 total, as visual anchors at line starts or ends — never clustered.
- Hashtags: 3–5 on the final line — mix the niche, the locale (city/country from the data when present), and the business name as a brand tag.
- Total under 500 characters.
- Voice: Arabic, in the business's OWN register and dialect as evidenced by <brand_voice> and its own text — the merchant talking to their customers, never a corporate announcement.

TRUTH — non-negotiable:
- Every fact (price, date, product, place, claim) must exist in the blocks above. Not there → not said.
- Do NOT write phone numbers or addresses — the platform appends the verified contact block automatically after your text.

Also return:
- "headline": 2–5 Arabic words the platform will typeset ON the image — the post's core idea as a poster line (e.g. «تشكيلة العطور وصلت»). No emojis, no punctuation except «!».
- "imageBrief": one English sentence describing a photographic scene that supports the post (subject, setting, mood, colors). The scene must work WITHOUT any text, letters, or numbers, and WITHOUT people or faces — products, places, and atmosphere only.

Return JSON: {"text": string, "headline": string, "imageBrief": string}`;
}

/** JSON-mode text call. Null on any failure — the caller maps to generation_failed. */
async function generatePostText(bundle: PageBundle, postType: PostSuggestionPostType): Promise<GeneratedText | null> {
    if (!config.openai?.apiKey) return null;
    const client = makeTrackedOpenAI(config.openai.apiKey, {
        userId: bundle.userId,
        pageId: bundle.pageId,
        pipeline: 'post_generation',
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TEXT_TIMEOUT_MS);
    let response;
    try {
        response = await client.chat.completions.create({
            model: POST_TEXT_MODEL,
            messages: [{ role: 'user', content: buildTextPrompt(bundle, postType, todayIso()) }],
            temperature: 0.8, // creative variety day to day — unlike extraction pipelines
            max_tokens: 1000,
            response_format: { type: 'json_object' },
        }, { signal: controller.signal });
    } catch (err) {
        // The wrapper already booked failed_before_log with timeout classification.
        captureError(err, 'Post suggestion: text generation failed', { tags: { service: 'post-suggestions' }, extra: { pageId: bundle.pageId } });
        return null;
    } finally {
        clearTimeout(timer);
    }

    const content = response.choices[0]?.message?.content;
    if (!content) {
        recordAiFailedBeforeLog('post_generation', POST_TEXT_MODEL, 'AiEmptyReplyError');
        return null;
    }
    try {
        const parsed = JSON.parse(content) as Partial<GeneratedText>;
        if (!parsed.text || typeof parsed.text !== 'string' || !parsed.text.trim()) {
            recordAiFailedBeforeLog('post_generation', POST_TEXT_MODEL, 'AiEmptyReplyError');
            return null;
        }
        return {
            text: parsed.text.trim(),
            imageBrief: typeof parsed.imageBrief === 'string' ? parsed.imageBrief.trim() : '',
            headline: typeof parsed.headline === 'string' ? parsed.headline.trim() : '',
        };
    } catch {
        recordAiFailedBeforeLog('post_generation', POST_TEXT_MODEL, 'Other');
        return null;
    }
}

function buildImagePrompt(imageBrief: string, category?: string): string {
    const forBusiness = category ? ` for a ${category} business` : '';
    // Two hard exclusions, both industry-standard (2026):
    // - no text: Arabic typography in gen models is broken — the caption carries the words;
    // - no people/faces: Meta auto-detects AI media via embedded C2PA and makes the
    //   label PROMINENT when a photorealistic person is generated; scenes/products
    //   keep the label unobtrusive and dodge the uncanny-valley trust hit.
    // Square 1024x1024: the only gpt-image size that renders uncropped on both FB
    // and IG feeds (its portrait option is 2:3, which the 4:5 feed would crop).
    return `${imageBrief}. Professional social-media promotional photograph${forBusiness}, warm and inviting, clean composition, square format. STRICT: absolutely no text, no letters, no words, no numbers, no logos, no watermarks, no signage with writing anywhere in the image. No people, no faces, no hands — products, scenery, and atmosphere only.`;
}

interface GeneratedImage {
    url: string;
    key: string;
}

/**
 * Image call + storage. Null = degrade to text-only (never fails the whole
 * suggestion): storage unconfigured, model refusal, timeout, or upload error.
 */
async function generatePostImage(bundle: PageBundle, imageBrief: string, headline: string): Promise<GeneratedImage | null> {
    if (!config.openai?.apiKey || !imageBrief || !imageStorage.isConfigured()) return null;
    const client = makeTrackedOpenAI(config.openai.apiKey, {
        userId: bundle.userId,
        pageId: bundle.pageId,
        pipeline: 'post_image_generation',
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
    let b64: string | undefined;
    try {
        const response = await client.images.generate({
            model: POST_IMAGE_MODEL,
            prompt: buildImagePrompt(imageBrief, bundle.category),
            size: POST_IMAGE_SIZE,
            quality: POST_IMAGE_QUALITY,
        }, { signal: controller.signal });
        b64 = response.data?.[0]?.b64_json;
    } catch (err) {
        // Wrapper booked failed_before_log (timeout-classified via our signal).
        captureError(err, 'Post suggestion: image generation failed', { level: 'warning', tags: { service: 'post-suggestions' }, extra: { pageId: bundle.pageId } });
        return null;
    } finally {
        clearTimeout(timer);
    }

    if (!b64) {
        // Billed response with no image payload — returns was booked, no row will follow.
        recordAiFailedBeforeLog('post_image_generation', POST_IMAGE_MODEL, 'AiEmptyReplyError');
        return null;
    }

    try {
        // Compose the DESIGNED card: brand scrim + typeset Arabic headline +
        // logo badge (deterministic sharp layers, zero AI cost, best-effort —
        // any layer failure ships whatever composed cleanly).
        const designed = await composePostCard(Buffer.from(b64, 'base64'), {
            headline,
            logoUrl: bundle.logoUrl,
        });
        const key = `generated-posts/${bundle.workspaceId}/${randomUUID()}.png`;
        return await imageStorage.put(key, designed, 'image/png');
    } catch (err) {
        captureError(err, 'Post suggestion: image upload failed', { tags: { service: 'post-suggestions' }, extra: { pageId: bundle.pageId } });
        return null;
    }
}

function toDto(row: typeof postSuggestions.$inferSelect): PostSuggestionDto {
    return {
        id: row.id,
        text: row.text,
        imageUrl: row.imageUrl,
        postType: (row.postType ?? 'general') as PostSuggestionPostType,
        source: row.source as 'cron' | 'manual',
        suggestedFor: row.suggestedFor,
        createdAt: (row.createdAt ?? new Date()).toISOString(),
    };
}

class PostSuggestionsService {
    /** Today's ready suggestion (latest wins — a manual regenerate supersedes older rows). */
    async getToday(workspaceId: string, pageId: string): Promise<{ suggestion: PostSuggestionDto | null; remainingToday: number }> {
        const today = todayIso();
        const [row] = await db.select().from(postSuggestions)
            .innerJoin(pages, eq(pages.id, postSuggestions.pageId))
            .where(and(
                eq(postSuggestions.pageId, pageId),
                eq(pages.workspaceId, workspaceId),
                eq(postSuggestions.suggestedFor, today),
                eq(postSuggestions.status, 'ready'),
            ))
            .orderBy(desc(postSuggestions.createdAt))
            .limit(1);

        let remainingToday = 0;
        try {
            const cap = await checkDailyCap(dailyCapKey(DAILY_CAP_PREFIX, pageId), config.postSuggestions.dailyCapPerPage);
            remainingToday = Math.max(0, cap.limit - cap.used);
        } catch {
            // Redis down: report 0 remaining — the generate path fails closed anyway.
        }
        return { suggestion: row ? toDto(row.post_suggestions) : null, remainingToday };
    }

    /**
     * Generate (or regenerate) today's suggestion. `source: 'manual'` comes from
     * the endpoint; the cron passes 'cron'. Both consume the SAME absolute daily
     * cap — owner ruling: 3/day, cron included.
     * `includeContact` (default true): whether to append the code-composed
     * contact footer — merchant-controlled per request (owner ruling 08-09:
     * «خيار يقدر التاجر يضيفه أو لا»).
     * `postType`: merchant-chosen angle for THIS generation (owner ruling
     * 08-09: «ما عطينا التاجر مجال يغير أو يجرب») — overrides the automatic
     * variety picker; still consumes a normal cap slot.
     */
    async generateSuggestion(workspaceId: string, pageId: string, source: 'cron' | 'manual', opts?: { includeContact?: boolean; postType?: PostSuggestionPostType }): Promise<GenerateResult> {
        if (!isPostSuggestionsEnabledForPage(pageId)) return { ok: false, reason: 'gated' };

        const capKey = dailyCapKey(DAILY_CAP_PREFIX, pageId);
        let cap: DailyCapStatus;
        try {
            cap = await checkDailyCap(capKey, config.postSuggestions.dailyCapPerPage);
        } catch (err) {
            // Fail closed: the cap is the only bound on real spend (dailyCap contract).
            captureError(err, 'Post suggestion: cap check unavailable', { tags: { service: 'post-suggestions' }, extra: { pageId } });
            return { ok: false, reason: 'cap_check_unavailable' };
        }
        if (!cap.allowed) return { ok: false, reason: 'daily_cap', cap };
        // Increment BEFORE the paid calls: if they fail, one slot is burned —
        // bounding spend beats refunding a slot on every error path.
        await incrementDailyCap(capKey);

        const bundle = await buildPageBundle(workspaceId, pageId);
        if (!bundle) return { ok: false, reason: 'page_not_found' };

        const today = todayIso();
        const [previous] = await db.select({ postType: postSuggestions.postType }).from(postSuggestions)
            .where(and(eq(postSuggestions.pageId, pageId), eq(postSuggestions.suggestedFor, today)))
            .orderBy(desc(postSuggestions.createdAt))
            .limit(1);
        // Merchant-chosen angle wins; otherwise the variety picker rotates.
        const postType = opts?.postType ?? pickPostType(bundle, previous?.postType ?? null);

        const generated = await generatePostText(bundle, postType);
        if (!generated) return { ok: false, reason: 'generation_failed' };
        // Deterministic contact footer — appended in code, never model-written.
        const includeContact = opts?.includeContact !== false;
        const finalText = includeContact && bundle.contactSuffix
            ? `${generated.text}\n\n${bundle.contactSuffix}`
            : generated.text;

        const image = await generatePostImage(bundle, generated.imageBrief, generated.headline);
        const imageDegraded: 'image_failed' | 'storage_off' | undefined = image
            ? undefined
            : (imageStorage.isConfigured() ? 'image_failed' : 'storage_off');

        // Supersede today's previous ready rows and clean their images —
        // ONE post per day, a regenerate REPLACES (owner ruling 2026-08-09).
        const stale = await db.select({ id: postSuggestions.id, imageKey: postSuggestions.imageKey })
            .from(postSuggestions)
            .where(and(
                eq(postSuggestions.pageId, pageId),
                eq(postSuggestions.suggestedFor, today),
                eq(postSuggestions.status, 'ready'),
            ));
        if (stale.length > 0) {
            await db.update(postSuggestions)
                .set({ status: 'superseded', imageUrl: null, imageKey: null })
                .where(inArray(postSuggestions.id, stale.map(s => s.id)));
            for (const s of stale) {
                if (s.imageKey) void imageStorage.remove(s.imageKey); // best-effort; audit script sweeps leftovers
            }
        }

        const [row] = await db.insert(postSuggestions).values({
            pageId,
            suggestedFor: today,
            source,
            postType,
            text: finalText,
            imageUrl: image?.url ?? null,
            imageKey: image?.key ?? null,
            status: 'ready',
        }).onConflictDoNothing({
            target: [postSuggestions.pageId, postSuggestions.suggestedFor],
            // Matches uq_post_suggestions_cron_once's predicate so Postgres
            // infers the partial unique index as the arbiter.
            where: sql`source = 'cron'`,
        }).returning();

        // onConflictDoNothing only ever suppresses the CRON insert (partial unique
        // index): the sibling deploy already generated today's row. Treat as done.
        if (!row) {
            const existing = await this.getToday(workspaceId, pageId);
            if (existing.suggestion) return { ok: true, suggestion: existing.suggestion, remainingToday: existing.remainingToday };
            return { ok: false, reason: 'generation_failed' };
        }

        const remaining = Math.max(0, cap.limit - cap.used - 1);
        return { ok: true, suggestion: toDto(row), remainingToday: remaining, ...(imageDegraded ? { imageDegraded } : {}) };
    }

    /** First-write-wins market-signal stamps. Returns false when the row isn't visible to this workspace. */
    async markEvent(workspaceId: string, pageId: string, suggestionId: string, event: PostSuggestionEvent): Promise<boolean> {
        const [row] = await db.select({ id: postSuggestions.id })
            .from(postSuggestions)
            .innerJoin(pages, eq(pages.id, postSuggestions.pageId))
            .where(and(
                eq(postSuggestions.id, suggestionId),
                eq(postSuggestions.pageId, pageId),
                eq(pages.workspaceId, workspaceId),
            ))
            .limit(1);
        if (!row) return false;

        // First-write-wins without a read-modify-write race: the IS NULL guard
        // in the UPDATE's WHERE makes a second stamp a no-op at the DB level.
        const column = event === 'opened' ? postSuggestions.openedAt
            : event === 'copied' ? postSuggestions.copiedAt
                : postSuggestions.downloadedAt;
        await db.update(postSuggestions)
            .set(event === 'opened' ? { openedAt: new Date() } : event === 'copied' ? { copiedAt: new Date() } : { downloadedAt: new Date() })
            .where(and(eq(postSuggestions.id, suggestionId), isNull(column)));
        return true;
    }

    /**
     * Daily cron: pre-generate for every explicitly allowlisted page. Skips a
     * page when today's cron row already exists (restart/blue-green safe — the
     * partial unique index backstops the race) or when the last
     * CRON_UNOPENED_STREAK cron suggestions were never opened (waste guard:
     * a forgotten pilot must not drip spend).
     */
    async runDailyPostSuggestions(): Promise<{ generated: number; skipped: number }> {
        const result = { generated: 0, skipped: 0 };
        for (const pageId of config.postSuggestions.pageIds) {
            if (!isCronEligiblePage(pageId)) { result.skipped++; continue; }
            try {
                const today = todayIso();
                const [existing] = await db.select({ id: postSuggestions.id }).from(postSuggestions)
                    .where(and(
                        eq(postSuggestions.pageId, pageId),
                        eq(postSuggestions.suggestedFor, today),
                        eq(postSuggestions.source, 'cron'),
                    )).limit(1);
                if (existing) { result.skipped++; continue; }

                const recentCron = await db.select({ openedAt: postSuggestions.openedAt }).from(postSuggestions)
                    .where(and(eq(postSuggestions.pageId, pageId), eq(postSuggestions.source, 'cron')))
                    .orderBy(desc(postSuggestions.createdAt))
                    .limit(CRON_UNOPENED_STREAK);
                if (recentCron.length === CRON_UNOPENED_STREAK && recentCron.every(r => !r.openedAt)) {
                    logger.info('[PostSuggestions] Skipping page — last cron suggestions unopened', { pageId });
                    result.skipped++;
                    continue;
                }

                const [page] = await db.select({ workspaceId: pages.workspaceId }).from(pages).where(eq(pages.id, pageId)).limit(1);
                if (!page?.workspaceId) { result.skipped++; continue; }

                const generated = await this.generateSuggestion(page.workspaceId, pageId, 'cron');
                if (generated.ok) {
                    result.generated++;
                    logger.info('[PostSuggestions] Cron generated', { pageId, postType: generated.suggestion.postType });
                } else {
                    result.skipped++;
                    logger.warn('[PostSuggestions] Cron generation failed', { pageId, reason: generated.reason });
                }
            } catch (err) {
                result.skipped++;
                captureError(err, 'Post suggestion cron failed for page', { tags: { service: 'post-suggestions' }, extra: { pageId } });
            }
        }
        return result;
    }
}

export const postSuggestionsService = new PostSuggestionsService();
