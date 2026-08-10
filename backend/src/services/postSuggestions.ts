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
 *      (owner: 3, «ليس أكثر») — the daily cron generation consumes 1 of them.
 *      Enforced as an atomic Redis claim (INCR-as-arbiter) FLOORED by the
 *      durable count of today's rows, so neither a concurrency race nor a
 *      lost Redis key can re-open spend,
 *   3. the route's rate limit (2/min).
 *
 * The business bundle is assembled with the SAME service calls the
 * playground path uses (playgroundContext.ts) — buildCatalogPromptBlock,
 * buildFactCollectionsContext (ungated: no messageText → full live rows),
 * formatBusinessInfoPrompt — never a re-derivation of the reply pipeline.
 */
import { and, desc, eq, gt, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import {
    formatBusinessInfoPrompt,
    unwrapBusinessProfile,
    whatsappNumbers,
    isRowLive,
    normalizeArabicIndic,
    DEFAULT_AI_MODEL,
    type BusinessProfile,
    type StoredBusinessProfile,
    type PostSuggestionDto,
    type PostSuggestionEvent,
    type PostSuggestionImageDegraded,
    type PostSuggestionPostType,
} from '@jawab24/shared';
import { db } from '../db';
import { pages, catalogItems, factCollections, factRows, postSuggestions } from '../db/schema';
import { config } from '../config';
import { makeTrackedOpenAI } from './openaiClient';
import { recordAiFailedBeforeLog } from '../lib/aiMetrics';
import { dailyCapKey, checkDailyCap, claimDailyCapSlot, type DailyCapStatus } from '../lib/dailyCap';
import { imageStorage } from './imageStorage';
import { composePostCard, fetchRoundedLogo } from './imageCompose';
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
/**
 * How many recent scenes the image brief must avoid repeating. Five ≈ a working
 * week, which is the span over which a merchant's feed reads as samey. Larger
 * windows spend prompt tokens on scenes nobody remembers.
 */
const RECENT_BRIEF_WINDOW = 5;

let logger: Logger = noopLogger;
export function setPostSuggestionsLogger(l: Logger): void { logger = l; }

/**
 * Whether the feature is live for this WORKSPACE (owner ruling 2026-08-09:
 * the pilot belongs to the founder's workspace, not to page lists). Pure and
 * exported so the gate is unit-testable on its own (shouldVerifyGrounding
 * posture). Empty allowlist = fleet-wide once enabled (the GA path);
 * non-empty = only those workspaces.
 */
export function isPostSuggestionsEnabledForWorkspace(workspaceId: string): boolean {
    if (!config.postSuggestions?.enabled) return false;
    const allowed = config.postSuggestions.workspaceIds;
    if (allowed && allowed.length > 0 && !allowed.includes(workspaceId)) return false;
    return true;
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
    | {
        ok: true;
        suggestion: PostSuggestionDto;
        /** null only on the suppressed-insert fallback when the cap store is unreachable. */
        remainingToday: number | null;
        imageDegraded?: PostSuggestionImageDegraded;
        /** Post-generation availability — the response mirrors getToday's envelope (one shape). */
        availableTypes: PostSuggestionPostType[];
    }
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
 * The workspace-scoped page read every entry point starts with. Ownership is
 * resolved from THIS read, BEFORE any cap read or spend: the cap key is
 * pageId-scoped, so a pre-ownership cap write would let any enabled workspace
 * burn another tenant's daily slots (and a 404 would burn a real one).
 */
async function fetchOwnedPage(workspaceId: string, pageId: string) {
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
    return page ?? null;
}

type OwnedPage = NonNullable<Awaited<ReturnType<typeof fetchOwnedPage>>>;

/**
 * Assemble everything the text prompt needs from an already-ownership-checked
 * page row, using the same building blocks as playgroundContext.ts. `userId`
 * and `workspaceId` are passed pre-narrowed — the caller has already refused
 * pages with no owner to bill.
 */
async function buildPageBundle(page: OwnedPage, userId: string, workspaceId: string, today: string): Promise<PageBundle> {
    const pageId = page.id;
    const { merchant, merchantProvenance } = unwrapBusinessProfile(page.businessProfile as StoredBusinessProfile);
    const businessInfoBlock = formatBusinessInfoPrompt(merchant ?? null, merchantProvenance) || undefined;
    const hasHours = hasBusinessHours(merchant);
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
        brandVoiceNotes = (await settingsService.getSettings(userId)).brandVoiceNotes || undefined;
    } catch {
        // Non-critical — the post falls back to a neutral merchant voice.
    }

    const hasCatalog = Boolean(productCatalog && productCatalog.trim().length > 0);
    const hasLiveDatedRow = await pageHasLiveDatedRow(pageId, today);

    // Logo for the corner badge, chosen by the card's DESTINATION. These cards
    // are published to the FACEBOOK PAGE, so the Facebook page's own picture is
    // the correct brand mark; the linked Instagram avatar is only a fallback for
    // a page that has none. (When Instagram posting arrives, that destination
    // should pick the IG avatar first — same rule, other channel.)
    //
    // The order used to be reversed, and it was wrong three ways: it branded a
    // Facebook post with another channel's identity; it stamped a PERSONAL photo
    // onto every card whenever the linked IG was a personal account (common for
    // small merchants) — while the image prompt forbids the model from drawing
    // people at all; and the stored IG url is a signed `scontent-*.fbcdn.net`
    // link carrying oe=/oh= expiry params, so the badge silently vanished once
    // it lapsed. The Graph picture endpoint is a stable redirect with none of
    // those problems.
    const logoUrl = (page.facebookPageId
        ? `https://graph.facebook.com/${page.facebookPageId}/picture?type=large&width=200&height=200`
        : undefined)
        || page.instagramProfilePicUrl
        || undefined;

    return {
        pageId,
        userId,
        workspaceId,
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

// ---------------------------------------------------------------------------
// Post-angle availability — ONE derivation, one home (Rule 10.8). Consumed by
// the variety picker, the merchant-override validation in generateSuggestion,
// AND the advertised `availableTypes` list, so the three answers can never
// drift apart again. The two data sources hold different evidence, and each
// passes what it honestly knows:
//   - buildPageBundle has the FETCHED catalog text, so its `hasCatalog` is
//     the truth: "the prompt will actually carry a <product_catalog> block".
//   - computeAvailableTypes runs on every dashboard card read from the page
//     row alone — for an ecommerce page it advertises product_spotlight from
//     `ecommerceStoreId` WITHOUT the store-context fetch (too expensive per
//     card render). That cheap advertisement is honest ONLY because
//     generateSuggestion re-validates the requested angle against the
//     bundle's fetched-catalog flags and downgrades to the picker when the
//     fetch yields nothing — both halves of that boundary are stated here
//     and nowhere else.
// ---------------------------------------------------------------------------

/** Which data-backed angles a page can deliver. `general` needs no data and is always available. */
export interface PostAngleFlags {
    hasLiveDatedRow: boolean;
    hasCatalog: boolean;
    hasHours: boolean;
    hasFaqTip: boolean;
}

/**
 * The predicate set behind every availability answer. The KB predicate is
 * normalized HERE: a whitespace-only KB is NO KB (the stricter of the two
 * readings that used to coexist — raw truthiness on the picker path once
 * advertised faq_tip for a blank-but-truthy string).
 */
export function computeAvailabilityFlags(signals: {
    hasLiveDatedRow: boolean;
    hasCatalog: boolean;
    hasHours: boolean;
    knowledgeBase?: string | null;
}): PostAngleFlags {
    return {
        hasLiveDatedRow: signals.hasLiveDatedRow,
        hasCatalog: signals.hasCatalog,
        hasHours: signals.hasHours,
        hasFaqTip: Boolean(signals.knowledgeBase?.trim()),
    };
}

/** Hours predicate — shared by the bundle and the availability list (one home). */
function hasBusinessHours(merchant: BusinessProfile | null | undefined): boolean {
    return Boolean(merchant?.hours && Object.keys(merchant.hours).length > 0);
}

/** Deliverable angles in picker-preference order. Empty ⇒ only `general` remains. */
function candidateTypes(flags: PostAngleFlags): PostSuggestionPostType[] {
    const candidates: PostSuggestionPostType[] = [];
    if (flags.hasLiveDatedRow) candidates.push('promo');
    if (flags.hasCatalog) candidates.push('product_spotlight');
    if (flags.hasFaqTip) candidates.push('faq_tip');
    if (flags.hasHours) candidates.push('hours_reminder');
    return candidates;
}

/**
 * Deterministic post-type picker — no AI call. Candidates come from what the
 * page actually has (the shared availability flags); the previous
 * suggestion's type is excluded when there is a choice, so consecutive days
 * vary.
 */
export function pickPostType(
    bundle: Pick<PageBundle, 'hasLiveDatedRow' | 'hasCatalog' | 'hasHours' | 'knowledgeBase'>,
    previousType: string | null,
): PostSuggestionPostType {
    const candidates = candidateTypes(computeAvailabilityFlags(bundle));
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

/**
 * The page's own recent scenes, so the model can avoid redrawing them.
 *
 * The angle picker has had cross-day memory since day one; the IMAGE never
 * did, which is why a service business with no physical product converged on
 * "laptop on a desk" every single morning. Same fix, applied to the half that
 * was missing it.
 */
export function buildRecentBriefsBlock(recentImageBriefs: readonly string[]): string {
    if (recentImageBriefs.length === 0) return '';
    const list = recentImageBriefs.map(b => `  - ${b}`).join('\n');
    return `\n  This page's recent scenes — do not redraw any of these:\n${list}`;
}

// NOTE (2026-08-10, measured): steering `imageBrief` from the prompt does not
// work on this model. Three attempts failed on the same page — listing the last
// five scenes with "must differ in SUBJECT and SETTING"; steering to the
// business's own world; and naming a concrete framing chosen in code ("the
// result the customer leaves with, presented on its own"). Each time the model
// returned the same Damascus classroom, varying only the daylight. The prompt
// was verified to contain every one of those instructions.
//
// The brief list below is kept because it costs almost nothing and a
// product-led page (nappy shelves) did vary; the shot-type rotation was removed
// rather than shipped, because it changed no output and its index could not
// move for a page with a full history window. The real fix is structural — see
// the note on buildRecentBriefsBlock's caller.

function buildTextPrompt(
    bundle: PageBundle,
    postType: PostSuggestionPostType,
    today: string,
    recentImageBriefs: readonly string[] = [],
): string {
    const recentBriefsBlock = buildRecentBriefsBlock(recentImageBriefs);
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
- Work the natural search keywords customers would type (product, city, need) INTO the caption text itself — 2026 social search reads captions, not just tags.
- Hashtags: 2–4 on the final line, sparingly — the niche, the locale (from the data when present), and the business name as a brand tag. Never hashtag-stuff.
- Total under 500 characters.
- Voice: Arabic, in the business's OWN register and dialect as evidenced by <brand_voice> and its own text — the merchant talking to their customers, never a corporate announcement.

TRUTH — non-negotiable:
- Every fact (price, date, product, place, claim) must exist in the blocks above. Not there → not said.
- Do NOT write phone numbers or addresses — the platform appends the verified contact block automatically after your text.
- FIGURES: every number you write must be copied from the data above. If the data carries no price for something, the post does not state one — invite the customer to ask instead. A figure in a post is public and permanent, and reads as a commitment the merchant never made.
- Carry only the figures TODAY'S ANGLE needs. A price belongs in a post whose subject is the offer; a post explaining how to choose a size is about the choosing, and a price bolted onto it reads as a sales pitch interrupting an answer. Fewer, well-placed numbers beat a caption that recites the data.

Also return:
- "headline": 2–5 Arabic words the platform will typeset ON the image — the poster line. The reader sees the poster and the caption AT ONCE, so the poster must not spend itself re-saying the caption's opening line.
  Test it: the headline must be a DIFFERENT KIND of line from the caption's opener. If the caption opens with a question, the headline is neither that question nor its direct answer — it is the RESULT the customer gets, or the reassurance, or the urgency. Rewording the same idea fails this test even though no words repeat.
    Caption «✨ هل تريد تحسين مهاراتك في الحاسوب؟ دورة ICDL تبدأ اليوم!»
      ✗ «دورة ICDL تبدأ اليوم» — verbatim from the caption
      ✓ «مقعدك بانتظارك» — urgency; a beat the caption never played
    Caption «❓ كيف تختار مقاس حفاضات طفلك؟»
      ✗ «اختر مقاس طفلك بسهولة» — no words repeat, but it is the same idea reworded
      ✓ «المقاس الصحيح من أول مرة» — the outcome, not the question
  No emojis, no punctuation except «!».
- "imageBrief": one English sentence describing a photographic scene that supports the post (subject, setting, mood, colors). The scene must work WITHOUT any text, letters, or numbers, and WITHOUT people or faces — products, places, and atmosphere only.
  Draw the scene from THIS business's own world — its goods, its materials, its workplace, the result its customers get. A generic desk with a laptop is the lazy default and says nothing about the business.${recentBriefsBlock}

Return JSON: {"text": string, "headline": string, "imageBrief": string}`;
}

/** Numeric tokens in a blob, normalised: Arabic-Indic → ASCII, separators dropped. */
function numericTokens(blob: string): string[] {
    return [...normalizeArabicIndic(blob).matchAll(/\d[\d.,]*/g)]
        .map(m => m[0].replace(/[.,]/g, ''))
        .filter(Boolean);
}

/**
 * Figures the model wrote that appear NOWHERE in its inputs.
 *
 * D-047 already forbids the model from writing PHONE digits — the platform
 * composes those in code, because one mangled digit is a lost sale. A PRICE is
 * the same kind of digit with a bigger blast radius, and on 2026-08-10 the
 * generator invented «45 د» on four consecutive runs for a page whose data
 * contains no price at all, wrapping the invented figure in otherwise perfectly
 * grounded facts. The prompt already forbade it and the merchant's own KB said
 * «لا تختلق أسعاراً»; both were ignored. A rule the model can ignore is not a
 * guard, so this one is deterministic.
 *
 * Token EQUALITY, never substring: the phone «0932456789» contains "45", and a
 * substring test would have accepted the very figure this exists to catch.
 * Comparison is list-free — no currency vocabulary to maintain in any language
 * (the no-hand-maintained-lists rule); any figure absent from the inputs is
 * unsupported, whatever it denominates.
 */
export function findUngroundedNumbers(text: string, groundingCorpus: string): string[] {
    const grounded = new Set(numericTokens(groundingCorpus));
    const seen = new Set<string>();
    const out: string[] = [];
    for (const token of numericTokens(text)) {
        if (grounded.has(token) || seen.has(token)) continue;
        seen.add(token);
        out.push(token);
    }
    return out;
}

/** Everything the prompt shows the model — the only figures it may repeat. */
function buildGroundingCorpus(bundle: PageBundle, today: string): string {
    return [
        bundle.pageName,
        today,
        bundle.businessInfoBlock,
        bundle.productCatalog,
        bundle.factCollectionsBlock,
        bundle.knowledgeBase,
        bundle.brandVoiceNotes,
    ].filter(Boolean).join('\n');
}

/** JSON-mode text call. Null on any failure — the caller maps to generation_failed. */
async function generatePostText(
    bundle: PageBundle,
    postType: PostSuggestionPostType,
    today: string,
    recentImageBriefs: readonly string[] = [],
): Promise<GeneratedText | null> {
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
            messages: [{ role: 'user', content: buildTextPrompt(bundle, postType, today, recentImageBriefs) }],
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
        const text = parsed.text.trim();

        // SHADOW ONLY — it logs, it never blocks. Figure invention has NOT been
        // observed here: the one case that looked like it (2026-08-10, «45 د»)
        // was real merchant data living in `fact_rows.price`, invisible to a
        // query that selected only name/attributes. Blocking on an unobserved
        // failure would reject valid posts and burn a merchant's daily slot, so
        // this measures first. Promote to a hard gate only if the numbers say so.
        const ungrounded = findUngroundedNumbers(text, buildGroundingCorpus(bundle, today));
        if (ungrounded.length > 0) {
            logger.warn('[PostSuggestions] Figures absent from the prompt inputs (shadow)', {
                pageId: bundle.pageId, postType, ungrounded,
            });
        }

        return {
            text,
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
 * suggestion): storage unconfigured, model refusal, timeout, undecodable
 * model output, or upload error.
 */
async function generatePostImage(bundle: PageBundle, imageBrief: string, headline: string): Promise<GeneratedImage | null> {
    if (!config.openai?.apiKey || !imageBrief || !imageStorage.isConfigured()) return null;
    const client = makeTrackedOpenAI(config.openai.apiKey, {
        userId: bundle.userId,
        pageId: bundle.pageId,
        pipeline: 'post_image_generation',
    });

    // The logo depends only on the bundle, so its fetch (up to 5s at
    // graph.facebook.com) starts NOW and runs concurrently with the image
    // call instead of adding sequential tail on a path the merchant watches
    // (Rule 17.3). A logo failure must never fail the generation: the fetch
    // resolves null on its own errors, and the extra catch pins that even if
    // its contract ever changes.
    const logoPromise: Promise<Buffer | null> = bundle.logoUrl
        ? fetchRoundedLogo(bundle.logoUrl).catch(() => null)
        : Promise.resolve(null);

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

    // JPEG, not PNG: photographic card with no transparency — ~10× smaller on
    // the market's mobile networks, and FB/IG accept JPEG for posts.
    const key = `generated-posts/${bundle.workspaceId}/${randomUUID()}.jpg`;
    try {
        // Compose the DESIGNED card: brand scrim + typeset Arabic headline +
        // logo badge (deterministic sharp layers, zero AI cost, best-effort —
        // any LAYER failure ships whatever composed cleanly; an undecodable
        // BASE returns null and the suggestion degrades to text-only).
        const designed = await composePostCard(Buffer.from(b64, 'base64'), {
            headline,
            logo: await logoPromise,
        });
        if (!designed) return null;
        return await imageStorage.put(key, designed, 'image/jpeg');
    } catch (err) {
        captureError(err, 'Post suggestion: image upload failed', { tags: { service: 'post-suggestions' }, extra: { pageId: bundle.pageId, key } });
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

/**
 * Which angles this page's DATA can actually deliver — the SAME flag
 * derivation the picker and the generate-time validation consume
 * (computeAvailabilityFlags), fed from the page row, so the UI never offers
 * a chip that would burn a capped attempt on an angle with nothing behind it
 * (best-practice: don't render undeliverable options; dogfood 08-09 — an
 * empty-profile page made «الدوام» produce an off-target post).
 *
 * `hasCatalog` here is the CHEAP answer (ecommerceStoreId / a catalog_items
 * probe, no store-context fetch) — see the availability block's boundary
 * note: generateSuggestion re-validates against the actually-fetched catalog.
 */
async function computeAvailableTypes(page: OwnedPage, today: string): Promise<PostSuggestionPostType[]> {
    const { merchant } = unwrapBusinessProfile(page.businessProfile as StoredBusinessProfile);

    const hasCatalog = page.ecommerceStoreId
        ? true
        : (await db.select({ id: catalogItems.id }).from(catalogItems)
            .where(and(eq(catalogItems.pageId, page.id), eq(catalogItems.isAvailable, true))).limit(1)).length > 0;
    const flags = computeAvailabilityFlags({
        hasLiveDatedRow: await pageHasLiveDatedRow(page.id, today),
        hasCatalog,
        hasHours: hasBusinessHours(merchant),
        knowledgeBase: page.knowledgeBase,
    });
    return ['general', ...candidateTypes(flags)];
}

class PostSuggestionsService {
    /**
     * Today's ready suggestion (latest wins — a manual regenerate supersedes
     * older rows). Null when the page doesn't belong to this workspace — the
     * caller 404s, and ownership resolves BEFORE the cap read so a foreign
     * page never even leaks its counter. The same page row feeds
     * computeAvailableTypes, so KB/profile are fetched exactly once.
     */
    async getToday(workspaceId: string, pageId: string): Promise<{ suggestion: PostSuggestionDto | null; remainingToday: number | null; availableTypes: PostSuggestionPostType[] } | null> {
        const today = todayIso();
        const page = await fetchOwnedPage(workspaceId, pageId);
        if (!page) return null;

        // Ownership is established above, so no pages join — and no
        // materializing the full pages row (KB text, accessToken) per card fetch.
        const [row] = await db.select().from(postSuggestions)
            .where(and(
                eq(postSuggestions.pageId, pageId),
                eq(postSuggestions.suggestedFor, today),
                eq(postSuggestions.status, 'ready'),
            ))
            .orderBy(desc(postSuggestions.createdAt))
            .limit(1);

        let remainingToday: number | null = null;
        try {
            const cap = await checkDailyCap(dailyCapKey(DAILY_CAP_PREFIX, pageId, today), config.postSuggestions.dailyCapPerPage);
            remainingToday = Math.max(0, cap.limit - cap.used);
        } catch (err) {
            // Redis down: remaining stays NULL (= unknown) — never report a
            // false "exhausted" that hides the regenerate UI for the incident's
            // duration; the generate path fails closed on its own. Captured
            // (fingerprinted) so a Redis incident on the highest-frequency cap
            // read is visible, not silently degraded.
            captureError(err, 'Post suggestion: getToday cap read failed', {
                level: 'warning',
                tags: { service: 'post-suggestions' },
                fingerprint: ['post-suggestions-cap-read'],
                extra: { pageId },
            });
        }
        const availableTypes = await computeAvailableTypes(page, today);
        return { suggestion: row ? toDto(row) : null, remainingToday, availableTypes };
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
     * variety picker WHEN the page's data can deliver it (otherwise the
     * picker runs and the row records the type actually used); still
     * consumes a normal cap slot.
     */
    async generateSuggestion(workspaceId: string, pageId: string, source: 'cron' | 'manual', opts?: { includeContact?: boolean; postType?: PostSuggestionPostType }): Promise<GenerateResult> {
        if (!isPostSuggestionsEnabledForWorkspace(workspaceId)) return { ok: false, reason: 'gated' };

        // ONE day for the whole call: cap key, DB count, supersede, and insert
        // all cut the same boundary even when the call straddles UTC midnight.
        const today = todayIso();

        // Ownership BEFORE the cap (guard order: gate → ownership → cap →
        // claim → paid calls). A foreign/unknown page must cost nothing: the
        // cap key is pageId-scoped, so a pre-ownership cap write would let any
        // enabled workspace burn another tenant's daily slots.
        const page = await fetchOwnedPage(workspaceId, pageId);
        const ownerId = page?.userId;
        const pageWorkspaceId = page?.workspaceId;
        if (!page || !ownerId || !pageWorkspaceId) return { ok: false, reason: 'page_not_found' };

        const capKey = dailyCapKey(DAILY_CAP_PREFIX, pageId, today);
        const limit = config.postSuggestions.dailyCapPerPage;
        let cap: DailyCapStatus;
        let dbUsed: number;
        try {
            // The Redis counter bounds ATTEMPTS (a failed generation burns its
            // slot by design); the DB row count grounds the cap in durable
            // truth, so a lost Redis key (eviction/failover — observed in the
            // 08-09 dogfood) can never silently re-open spend. Either read
            // failing → fail closed (dailyCap contract).
            const [capStatus, countRows] = await Promise.all([
                checkDailyCap(capKey, limit),
                db.select({ value: sql<number>`count(*)::int` }).from(postSuggestions)
                    .where(and(eq(postSuggestions.pageId, pageId), eq(postSuggestions.suggestedFor, today))),
            ]);
            cap = capStatus;
            dbUsed = Number(countRows[0]?.value ?? 0);
        } catch (err) {
            captureError(err, 'Post suggestion: cap check unavailable', { tags: { service: 'post-suggestions' }, extra: { pageId } });
            return { ok: false, reason: 'cap_check_unavailable' };
        }
        if (dbUsed > cap.used) {
            // The dogfood 08-09 counter-loss signal: durable rows exceed the
            // Redis counter, i.e. the counter was lost/reset. The DB floor
            // below keeps the cap honest regardless.
            logger.warn('[PostSuggestions] Daily-cap counter behind DB rows', { pageId, dbUsed, redisUsed: cap.used });
        }
        if (!cap.allowed || dbUsed >= limit) {
            return { ok: false, reason: 'daily_cap', cap: { allowed: false, used: Math.max(cap.used, dbUsed), limit } };
        }
        // Atomic claim BEFORE the paid calls: the INCR itself is the arbiter,
        // so two requests racing the last slot can never both pass (the
        // check-then-increment TOCTOU). If the paid calls then fail, the slot
        // stays burned — bounding spend beats refunding on every error path.
        let claimed: boolean;
        try {
            claimed = await claimDailyCapSlot(capKey, limit);
        } catch (err) {
            captureError(err, 'Post suggestion: cap claim unavailable', { tags: { service: 'post-suggestions' }, extra: { pageId } });
            return { ok: false, reason: 'cap_check_unavailable' };
        }
        if (!claimed) return { ok: false, reason: 'daily_cap', cap: { allowed: false, used: limit, limit } };

        const bundle = await buildPageBundle(page, ownerId, pageWorkspaceId, today);

        // Latest suggestion from ANY day: the variety picker must see
        // yesterday's angle, or the cron (always the first row of its day)
        // would open on the same first candidate every single morning.
        // One query serves both memories: [0] is the previous angle, and the
        // whole window feeds the image's anti-repetition list. Older rows are
        // superseded and their image files deleted, but the BRIEF survives —
        // which is the point of storing it.
        const recent = await db.select({
            postType: postSuggestions.postType,
            imageBrief: postSuggestions.imageBrief,
        }).from(postSuggestions)
            .where(eq(postSuggestions.pageId, pageId))
            .orderBy(desc(postSuggestions.createdAt))
            .limit(RECENT_BRIEF_WINDOW);
        const previous = recent[0];
        const recentImageBriefs = recent
            .map(r => r.imageBrief?.trim())
            .filter((b): b is string => Boolean(b));
        // Merchant-chosen angle wins ONLY when the page's data can actually
        // deliver it — validated against the SAME flags the picker consumes
        // (fetched-catalog truth, not the cheap advertisement; see the
        // availability block's boundary note). The chips are already
        // fail-closed, so an unavailable request here means chip/data drift
        // or a raw API caller. Unavailable ⇒ DOWNGRADE to the variety picker
        // rather than hard-fail: the cap slot is already claimed, and a
        // generated post beats burning it on an error. The inserted row (and
        // thereby the response DTO) carries the type actually used.
        const requested = opts?.postType;
        const deliverable = candidateTypes(computeAvailabilityFlags(bundle));
        const postType = requested && (requested === 'general' || deliverable.includes(requested))
            ? requested
            : pickPostType(bundle, previous?.postType ?? null);
        if (requested && postType !== requested) {
            logger.info('[PostSuggestions] Requested angle unavailable — downgraded to variety picker', { pageId, requested, used: postType });
        }

        const generated = await generatePostText(bundle, postType, today, recentImageBriefs);
        if (!generated) return { ok: false, reason: 'generation_failed' };
        // Deterministic contact footer — appended in code, never model-written.
        const includeContact = opts?.includeContact !== false;
        const finalText = includeContact && bundle.contactSuffix
            ? `${generated.text}\n\n${bundle.contactSuffix}`
            : generated.text;

        const image = await generatePostImage(bundle, generated.imageBrief, generated.headline);
        const imageDegraded: PostSuggestionImageDegraded | undefined = image
            ? undefined
            : (imageStorage.isConfigured() ? 'image_failed' : 'storage_off');

        // ONE post per day, a regenerate REPLACES (owner ruling 2026-08-09) —
        // and "replace" means the old row dies only when the new one exists.
        // Insert FIRST, then supersede, in ONE transaction: a suppressed cron
        // insert (blue/green race on the partial unique index) supersedes
        // NOTHING, and a crash between the two statements rolls both back.
        // Old images are removed only AFTER commit, per OBJECT_STORAGE.md's
        // safe order (upload new → commit DB → delete old).
        const staleKeys: string[] = [];
        const row = await db.transaction(async (tx) => {
            const [inserted] = await tx.insert(postSuggestions).values({
                pageId,
                suggestedFor: today,
                source,
                postType,
                text: finalText,
                imageUrl: image?.url ?? null,
                imageKey: image?.key ?? null,
                // Stored even when the image call failed: the brief is what the
                // NEXT generation must avoid repeating, and a failed render does
                // not make the scene fresh again.
                imageBrief: generated.imageBrief || null,
                status: 'ready',
            }).onConflictDoNothing({
                target: [postSuggestions.pageId, postSuggestions.suggestedFor],
                // Matches uq_post_suggestions_cron_once's predicate so Postgres
                // infers the partial unique index as the arbiter.
                where: sql`source = 'cron'`,
            }).returning();
            if (!inserted) return undefined;

            const stale = await tx.select({ id: postSuggestions.id, imageKey: postSuggestions.imageKey })
                .from(postSuggestions)
                .where(and(
                    eq(postSuggestions.pageId, pageId),
                    eq(postSuggestions.suggestedFor, today),
                    eq(postSuggestions.status, 'ready'),
                    ne(postSuggestions.id, inserted.id),
                ));
            if (stale.length > 0) {
                await tx.update(postSuggestions)
                    .set({ status: 'superseded', imageUrl: null, imageKey: null })
                    .where(inArray(postSuggestions.id, stale.map(s => s.id)));
                for (const s of stale) {
                    if (s.imageKey) staleKeys.push(s.imageKey);
                }
            }
            return inserted;
        });
        for (const staleKey of staleKeys) {
            void imageStorage.remove(staleKey); // best-effort; audit script sweeps leftovers
        }

        // onConflictDoNothing only ever suppresses the CRON insert (partial unique
        // index): the sibling deploy already generated today's row. Treat as done.
        if (!row) {
            const existing = await this.getToday(workspaceId, pageId);
            if (existing?.suggestion) {
                return { ok: true, suggestion: existing.suggestion, remainingToday: existing.remainingToday, availableTypes: existing.availableTypes };
            }
            return { ok: false, reason: 'generation_failed' };
        }

        // One envelope across routes: the generate response carries the SAME
        // availability list getToday serves, computed AFTER generation so the
        // chips track post-generation reality. Cheap — reuses the page row
        // this request already fetched (indexed probes only).
        const availableTypes = await computeAvailableTypes(page, today);

        // Remaining slots from the stricter of the two views, counting the
        // slot this generation just consumed.
        const remaining = Math.max(0, limit - Math.max(cap.used + 1, dbUsed + 1));
        return { ok: true, suggestion: toDto(row), remainingToday: remaining, availableTypes, ...(imageDegraded ? { imageDegraded } : {}) };
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
     * Daily cron: pre-generate for every CONNECTED page of the explicitly
     * allowlisted workspaces. STRICTER than the endpoint gate on purpose —
     * pre-generation is spend no user asked for, so an EMPTY workspace
     * allowlist means the cron does nothing even when the feature is enabled
     * fleet-wide. Skips a page when ANY of today's rows already exist —
     * manual included, because pre-generating then would SUPERSEDE the
     * merchant's chosen post, not fill a gap — or when the unopened-streak
     * waste guard trips (a forgotten pilot must not drip spend). The guard is
     * self-healing: only cron rows created after the page's latest engagement
     * stamp count, so a merchant coming back re-enables pre-generation.
     */
    async runDailyPostSuggestions(): Promise<{ eligible: number; generated: number; skippedExisting: number; skippedWasteGuard: number; failed: number }> {
        const startedAt = Date.now();
        const result = { eligible: 0, generated: 0, skippedExisting: 0, skippedWasteGuard: 0, failed: 0 };
        const workspaceIds = config.postSuggestions.workspaceIds;
        if (!config.postSuggestions.enabled || workspaceIds.length === 0) {
            // The most common healthy state must still leave a trace — an
            // empty allowlist is otherwise log-identical to "cron never fired".
            logger.info('[PostSuggestions] Daily run skipped — feature disabled or workspace allowlist empty');
            return result;
        }

        // Connected pages only — a page without a token can't be posted to,
        // so pre-generating for it is guaranteed waste.
        const eligiblePages = await db.select({ id: pages.id, workspaceId: pages.workspaceId }).from(pages)
            .where(and(
                inArray(pages.workspaceId, workspaceIds),
                isNotNull(pages.accessToken),
                ne(pages.accessToken, ''),
            ));
        result.eligible = eligiblePages.length;

        for (const page of eligiblePages) {
            const pageId = page.id;
            if (!page.workspaceId) { result.failed++; continue; }
            try {
                const today = todayIso();
                // Source-blind on purpose: a manual row counts as "the
                // merchant already has today's post".
                const [existing] = await db.select({ id: postSuggestions.id }).from(postSuggestions)
                    .where(and(
                        eq(postSuggestions.pageId, pageId),
                        eq(postSuggestions.suggestedFor, today),
                    )).limit(1);
                if (existing) { result.skippedExisting++; continue; }

                // Waste guard: count only cron rows created AFTER the page's
                // most recent engagement stamp (any source, any of the three
                // stamps) — engagement resets the streak instead of the guard
                // latching off forever once three cron rows go unopened.
                const [engagement] = await db.select({
                    lastEngagedAt: sql<string | Date | null>`max(greatest(${postSuggestions.openedAt}, ${postSuggestions.copiedAt}, ${postSuggestions.downloadedAt}))`,
                }).from(postSuggestions).where(eq(postSuggestions.pageId, pageId));
                const lastEngagedAt = engagement?.lastEngagedAt ? new Date(engagement.lastEngagedAt) : null;
                const recentCron = await db.select({ openedAt: postSuggestions.openedAt }).from(postSuggestions)
                    .where(and(
                        eq(postSuggestions.pageId, pageId),
                        eq(postSuggestions.source, 'cron'),
                        ...(lastEngagedAt ? [gt(postSuggestions.createdAt, lastEngagedAt)] : []),
                    ))
                    .orderBy(desc(postSuggestions.createdAt))
                    .limit(CRON_UNOPENED_STREAK);
                if (recentCron.length === CRON_UNOPENED_STREAK && recentCron.every(r => !r.openedAt)) {
                    logger.warn('[PostSuggestions] Waste guard tripped — skipping pre-generation', { pageId });
                    result.skippedWasteGuard++;
                    continue;
                }

                const generated = await this.generateSuggestion(page.workspaceId, pageId, 'cron');
                if (generated.ok) {
                    result.generated++;
                    logger.info('[PostSuggestions] Cron generated', { pageId, postType: generated.suggestion.postType });
                } else {
                    result.failed++;
                    logger.warn('[PostSuggestions] Cron generation failed', { pageId, reason: generated.reason });
                }
            } catch (err) {
                result.failed++;
                captureError(err, 'Post suggestion cron failed for page', { tags: { service: 'post-suggestions' }, extra: { pageId } });
            }
        }

        // Positive heartbeat + split counters (mirrors [LeadDigest]): "ran,
        // nothing to do" must be distinguishable from "never ran" and from
        // "ran and failed" in the production log.
        logger.info('[PostSuggestions] Daily run complete', { ...result, durationMs: Date.now() - startedAt });
        return result;
    }
}

export const postSuggestionsService = new PostSuggestionsService();
