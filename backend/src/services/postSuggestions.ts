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
import { and, desc, eq, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import {
    formatBusinessInfoPrompt,
    unwrapBusinessProfile,
    whatsappNumbers,
    businessPhoneEntries,
    phoneEntryNumber,
    phoneEntryDescription,
    isRowLive,
    normalizeArabicIndic,
    DEFAULT_AI_MODEL,
    POST_SUGGESTION_VARIANT_COUNT,
    type BusinessProfile,
    type StoredBusinessProfile,
    type PostSuggestionDto,
    type PostSuggestionHistoryItem,
    type PostSuggestionInFlight,
    type PostSuggestionEvent,
    type PostSuggestionImageDegraded,
    type PostSuggestionPostType,
    type PostSuggestionStatus,
} from '@jawab24/shared';
import { db } from '../db';
import { pages, catalogItems, factCollections, factRows, postSuggestions, workspaces, type PostSuggestionVariantRow } from '../db/schema';
import { subscriptionsService } from './subscriptions';
import { config } from '../config';
import { makeTrackedOpenAI } from './openaiClient';
import { recordAiFailedBeforeLog } from '../lib/aiMetrics';
import { dailyCapKey, checkDailyCap, claimDailyCapSlot, type DailyCapStatus } from '../lib/dailyCap';
// imageKeysOf is NOT imported any more: superseding a post no longer deletes
// its images. It still lives in the lib for page deletion, which does.
import { variantsOf } from '../lib/postSuggestionVariants';
import { enqueuePostSuggestion } from '../lib/postSuggestionQueue';
import { imageStorage } from './imageStorage';
import { composePostCard, fetchRoundedLogo, renderPosterBase } from './imageCompose';
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
/**
 * How many earlier posts the sheet's history strip carries.
 *
 * Bounded because this rides on the card fetch, which is the highest-frequency
 * read in the feature — an unbounded list would grow without limit for a
 * merchant who generates daily for a year. Ten is roughly "what I made
 * recently"; older posts stay in the table and are reachable by id.
 */
const HISTORY_LIMIT = 10;
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
 * posture).
 *
 * ⭐ FAILS CLOSED. An EMPTY allowlist means OFF, not "everyone".
 *
 * It used to mean fleet-wide, and was documented as "the GA path" — so the
 * intuitive way to disable the pilot (clear `POST_SUGGESTIONS_WORKSPACE_IDS`)
 * was in fact the way to hand a feature that spends a PAID text call and a PAID
 * image call per generation to every workspace on every tier, including free
 * and trial. One env var, no second confirmation, no plan check behind it.
 *
 * A gate whose most dangerous state is also its emptiest is not a gate. Opening
 * this feature to more merchants is now something you do by SAYING SO — either
 * by listing workspaces, or by turning on the plan gate below, which is the
 * real GA path (owner ruling 2026-08-09: Business and above).
 */
export function isPostSuggestionsEnabledForWorkspace(workspaceId: string): boolean {
    if (!config.postSuggestions?.enabled) return false;
    if (config.postSuggestions.workspaceIds?.includes(workspaceId)) return true;
    // Not named explicitly ⇒ only the plan gate can admit this workspace, and
    // it is off until GA. Never "true because the list was empty".
    return config.postSuggestions.planGateEnabled === true;
}

/**
 * Plans that may use the feature at GA — "Business and above" (owner ruling
 * 2026-08-09, recorded in SYSTEM_ANALYSIS as «الأعمال + الاحترافي»).
 *
 * ⛔ Deliberately an ORDER, not the literal `['business','pro']` the ruling was
 * phrased with. The catalogue also sells `scale-20k` and `scale-30k`, which are
 * LARGER than Pro — a two-slug list would have silently excluded the biggest
 * paying customers while admitting nobody by accident, i.e. failed quietly in
 * the direction nobody checks. Rank comparison keeps new tiers correct by
 * default: anything at or above Business is in.
 */
export const PLAN_RANK: Readonly<Record<string, number>> = {
    starter: 1,
    business: 2,
    pro: 3,
    'scale-20k': 4,
    'scale-30k': 5,
};
const MIN_PLAN_RANK = PLAN_RANK.business;

/**
 * Does this plan slug clear the GA bar?
 *
 * An UNKNOWN slug is refused. A plan we cannot rank is a plan we cannot say is
 * entitled, and the failure we can afford is "a paying merchant asks why the
 * card is missing" — not "every trial account generates paid images".
 */
export function planAllowsPostSuggestions(slug: string | null | undefined): boolean {
    if (!slug) return false;
    const rank = PLAN_RANK[slug];
    return rank !== undefined && rank >= MIN_PLAN_RANK;
}

/**
 * The REAL gate: config, then — once GA is on — the workspace's plan.
 *
 * Async because entitlement is a fact about the merchant's subscription, not
 * about the process's env. The sync
 * `isPostSuggestionsEnabledForWorkspace` above stays as the cheap
 * config-only half, so the dark-feature 404s cost no query while the pilot is
 * allowlist-only; this adds a lookup ONLY on the GA path.
 *
 * Fails CLOSED on every uncertainty — no subscription, unknown plan, a DB error
 * mid-lookup. An entitlement check that admits people when it cannot answer is
 * not a check, and the thing behind this one costs real money per press.
 */
export async function isPostSuggestionsEntitled(workspaceId: string): Promise<boolean> {
    if (!config.postSuggestions?.enabled) return false;
    // Named workspaces (the pilot) skip the plan entirely — the owner invited
    // them by hand, and a tester must not lose the feature the day GA lands.
    if (config.postSuggestions.workspaceIds?.includes(workspaceId)) return true;
    if (config.postSuggestions.planGateEnabled !== true) return false;

    try {
        const [ws] = await db.select({ ownerId: workspaces.ownerId })
            .from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
        if (!ws?.ownerId) return false;
        const sub = await subscriptionsService.getUserSubscription(ws.ownerId);
        // Only a LIVE subscription entitles. `past_due` is the state that
        // already silently starved 8 pages of replies on 2026-08-09; it must
        // not quietly keep buying images here.
        if (!sub || (sub.status !== 'active' && sub.status !== 'trialing')) return false;
        return planAllowsPostSuggestions(sub.plan?.slug);
    } catch (err) {
        logger.warn('[PostSuggestions] Entitlement lookup failed; refusing', {
            workspaceId, error: err instanceof Error ? err.message : String(err),
        });
        return false;
    }
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

    // ⭐ A post is PUBLIC and UNCONDITIONAL, so it must not publish a number
    // whose purpose restricts it. Once a contact point can say what it is for,
    // «الإدارة — عند الطلب فقط» is a real stored value (it is this PR's own
    // worked example and its demo fixture), and taking `[0]` bare published that
    // number to everyone with the condition silently stripped — honoured by the
    // reply prompt, ignored here.
    //
    // So: prefer the first UNCONDITIONAL line. By the canonical-form invariant
    // (businessPhone.ts) "no description" is exactly "stored as a bare string",
    // so this reads the merchant's own signal rather than guessing at wording —
    // no keyword list of restriction phrases, which would be a hand-maintained
    // linguistic list and would miss every phrasing it did not anticipate.
    //
    // If EVERY line carries a purpose, fall back to the first but render the
    // purpose with it, so the condition travels instead of being dropped.
    const entries = businessPhoneEntries(merchant);
    const unconditional = entries.find((e) => !e.description);
    const chosen = unconditional ?? entries[0];
    // Trim for OUTPUT only. businessPhoneEntries deliberately publishes a bare
    // stored string verbatim to keep BUSINESS_INFO byte-identical; a post suffix
    // is not that block, and « 0911 » with padding in a public post is a defect.
    const phone = chosen ? phoneEntryNumber(chosen).trim() : undefined;
    if (phone) {
        const purpose = chosen && !unconditional ? phoneEntryDescription(chosen) : '';
        lines.push(purpose ? `📞 ${phone} (${purpose})` : `📞 ${phone}`);
    }

    // whatsappNumbers is THE reader of the field's legacy string|array dual shape.
    // Compare on the TRIMMED number: whatsappNumbers trims and the phone list
    // does not, so an untrimmed stored number used to fail this equality and
    // publish the same line twice — once as 📞 and once as واتساب.
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
        /**
         * The post the merchant HAS while this one is written — null on a
         * page's first ever generation. Same meaning as getCurrent's field, so
         * a claimed request leaves the previous post on screen instead of
         * blanking it for the ~35s the worker takes.
         */
        suggestion: PostSuggestionDto | null;
        /** The row this call just claimed, until it becomes the post above. */
        inFlight: PostSuggestionInFlight | null;
        /** null only on the suppressed-insert fallback when the cap store is unreachable. */
        remainingToday: number | null;
        /** Post-generation availability — the response mirrors getCurrent's envelope (one shape). */
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

/**
 * The page's CURRENT post — the newest `ready` row, or null if it never made
 * one.
 *
 * ⛔ Status-filtered, NOT "the newest row". Reading the newest row of any
 * non-superseded status is what let a `failed` row become the answer: a
 * generation that fails supersedes nothing, so it lands NEWER than the intact
 * post it did not replace. Day-scoped that self-healed at midnight; on-demand
 * it is permanent — the post is masked, and `history` cannot reach it either
 * (that is superseded rows only). What is happening is `readInFlight`'s job.
 *
 * Ownership is NOT checked here — callers resolve it via fetchOwnedPage first,
 * and re-checking would mean a second pages read on the highest-frequency fetch
 * in the feature.
 */
/**
 * Today's cap for one page — the SINGLE arithmetic both the read and the write
 * path use.
 *
 * ⛔ It exists because they used to compute it differently, and the drift was
 * user-visible. `readRemainingToday` reported `limit - redisUsed` while
 * `requestSuggestion` refused on `dbUsed >= limit`, so a page whose Redis key
 * was gone but whose rows were not read as «3 attempts left» and answered every
 * one of them with «بلغت الحد اليومي». Measured on تقنيات الشام, 2026-08-14:
 * three durable rows for the day, no counter key, GET reporting 3 remaining and
 * POST returning 429 in the same second. No amount of UI gating can fix that —
 * the client was being handed a number the server would not honour.
 *
 * Redis bounds ATTEMPTS (a failed generation burns its slot by design); the
 * durable row count is the FLOOR that survives a lost key (eviction/failover,
 * observed in the 08-09 dogfood). The truth is whichever is higher.
 *
 * Throws when either source is unreachable — both callers fail closed on that,
 * which is the dailyCap contract: the cap is the only bound on real spend.
 */
async function readCapStatus(pageId: string, today: string, limit: number): Promise<{ used: number; limit: number; allowed: boolean }> {
    const [cap, countRows] = await Promise.all([
        checkDailyCap(dailyCapKey(DAILY_CAP_PREFIX, pageId, today), limit),
        // Served by idx_post_suggestions_page_date — (page_id, suggested_for) is
        // exactly this predicate, so the count the read path now pays for is an
        // index scan running INSIDE an existing parallel batch, not a new
        // sequential hop (Rule 17.3).
        db.select({ value: sql<number>`count(*)::int` }).from(postSuggestions)
            .where(and(eq(postSuggestions.pageId, pageId), eq(postSuggestions.suggestedFor, today))),
    ]);
    const dbUsed = Number(countRows[0]?.value ?? 0);
    if (dbUsed > cap.used) {
        // Durable rows exceed the counter, i.e. the counter was lost or reset.
        // The DB floor below keeps the cap honest regardless.
        logger.warn('[PostSuggestions] Daily-cap counter behind DB rows', { pageId, dbUsed, redisUsed: cap.used });
    }
    return { used: Math.max(cap.used, dbUsed), limit, allowed: cap.allowed && dbUsed < limit };
}

async function readCurrentPost(pageId: string) {
    const [row] = await db.select().from(postSuggestions)
        .where(and(
            eq(postSuggestions.pageId, pageId),
            eq(postSuggestions.status, 'ready'),
        ))
        .orderBy(desc(postSuggestions.createdAt))
        .limit(1);
    return row ?? null;
}

/**
 * The latest attempt, when it is not (yet) a post — else null.
 *
 * PENDING and FAILED are both served: this is what the client polls, so hiding
 * a pending row would report "nothing happening" over work already paid for,
 * and hiding a failed one would leave the merchant waiting on something that
 * ended. Ordering over all three live statuses (not just the two) is what makes
 * "null" mean *settled*: once the attempt becomes the newest `ready` row there
 * is nothing in flight, and the failed rows underneath it stay history the
 * merchant never has to look at.
 */
async function readInFlight(pageId: string): Promise<PostSuggestionInFlight | null> {
    const [latest] = await db.select({ id: postSuggestions.id, status: postSuggestions.status })
        .from(postSuggestions)
        .where(and(
            eq(postSuggestions.pageId, pageId),
            inArray(postSuggestions.status, ['ready', 'pending', 'failed']),
        ))
        .orderBy(desc(postSuggestions.createdAt))
        .limit(1);
    if (!latest || latest.status === 'ready') return null;
    return { id: latest.id, status: latest.status as 'pending' | 'failed' };
}

/**
 * The page's earlier posts, newest first — the ones a new generation replaced.
 *
 * Only `superseded`: a 'failed' row has no post in it to go back to, and the
 * CURRENT row is served separately by the caller.
 *
 * READ PATH ONLY. The generate route deliberately does not call this: it answers
 * with a `pending` row and the worker supersedes the previous post seconds
 * later, so a list built there is one behind by construction — and the client is
 * already polling this path, which answers correctly.
 *
 * Ownership is NOT checked here — `getCurrent` resolves it via fetchOwnedPage
 * before calling, and re-checking would mean a second pages read on the
 * highest-frequency fetch in the feature.
 */
async function readPostHistory(pageId: string): Promise<PostSuggestionHistoryItem[]> {
    const earlier = await db.select({
        id: postSuggestions.id,
        text: postSuggestions.text,
        imageUrl: postSuggestions.imageUrl,
        postType: postSuggestions.postType,
        createdAt: postSuggestions.createdAt,
    }).from(postSuggestions)
        .where(and(
            eq(postSuggestions.pageId, pageId),
            eq(postSuggestions.status, 'superseded'),
        ))
        .orderBy(desc(postSuggestions.createdAt))
        .limit(HISTORY_LIMIT);
    return earlier.map(e => ({
        id: e.id,
        text: e.text,
        imageUrl: e.imageUrl,
        postType: (e.postType ?? 'general') as PostSuggestionPostType,
        createdAt: (e.createdAt ?? new Date()).toISOString(),
    }));
}

/**
 * The same page row, addressed by id alone.
 *
 * The worker fulfils a row whose ownership was already established by the
 * request that created it, so re-checking the workspace there would be
 * theatre — the id in hand came from our own table, not from a caller.
 * Deliberately NOT exported: every externally-reachable path still goes
 * through the workspace-scoped `fetchOwnedPage`.
 */
async function fetchPageById(pageId: string) {
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
    }).from(pages).where(eq(pages.id, pageId)).limit(1);
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

/**
 * The KIND of image, rotated in code. This is the fix for the sameness problem
 * that three prompt-level attempts could not solve (2026-08-10).
 *
 * The failed attempts all asked the model for a different photographic SCENE,
 * which a service business cannot supply — a training institute's world really
 * is one room, so "stay in your world" and "change the subject" contradict each
 * other. Two independent product reviewers reached the same conclusion
 * separately: vary the TYPE of image, not the scene inside it.
 *
 *   photo      — a real scene (what shipped first; still the strongest for
 *                product-led pages, where it already varies on its own)
 *   poster     — typography on a branded background, drawn entirely in code.
 *                NO image model: zero cost, zero latency, and immune to the
 *                model ignoring instructions — which is precisely what it did.
 *   conceptual — materials, texture and light rather than a literal place;
 *                the escape hatch for a business with no photogenic scene.
 */
export const IMAGE_MODES = ['photo', 'poster', 'conceptual'] as const;
export type ImageMode = (typeof IMAGE_MODES)[number];

/**
 * Round-robin from the previous mode, so all three actually appear.
 *
 * Deliberately NOT `filter(m => m !== previous)[0]` — the shape pickPostType
 * uses. That returns the first surviving candidate, which ping-pongs between
 * the top two and never reaches the third. An unknown or absent previous mode
 * starts the cycle at `photo`.
 */
export function pickImageMode(previousMode: string | null | undefined): ImageMode {
    const i = IMAGE_MODES.indexOf(previousMode as ImageMode);
    return IMAGE_MODES[(i + 1) % IMAGE_MODES.length] as ImageMode;
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

/** One take as the model returned it, before the contact footer is appended. */
interface GeneratedTake {
    text: string;
    /** 2–5 Arabic words the compositor typesets ON the image (we render it — never the image model). */
    headline: string;
}

interface GeneratedText {
    /** 1..POST_SUGGESTION_VARIANT_COUNT takes — never empty (the caller treats empty as a failure). */
    posts: GeneratedTake[];
    /** ONE scene for the whole set: the takes share a single paid image. */
    imageBrief: string;
}

/**
 * Takes from a parsed model response, tolerantly.
 *
 * Accepts the single-object shape too (`{text, headline}`), because a model
 * asked for N can still answer with one — and a merchant is far better served
 * by one usable post than by a hard failure that burns a daily slot. Anything
 * beyond the requested count is dropped rather than stored: the cap the owner
 * set is on what we PAY for, but the UI budget is on what a merchant can
 * actually compare, and an over-long list silently changes both.
 */
export function parseTakes(parsed: unknown): GeneratedTake[] {
    const root = parsed as { posts?: unknown; text?: unknown; headline?: unknown } | null;
    if (!root || typeof root !== 'object') return [];
    const raw: unknown[] = Array.isArray(root.posts) ? root.posts : [root];
    const takes: GeneratedTake[] = [];
    for (const entry of raw) {
        const take = entry as { text?: unknown; headline?: unknown } | null;
        if (!take || typeof take !== 'object') continue;
        if (typeof take.text !== 'string' || !take.text.trim()) continue;
        takes.push({
            text: take.text.trim(),
            headline: typeof take.headline === 'string' ? take.headline.trim() : '',
        });
        if (takes.length === POST_SUGGESTION_VARIANT_COUNT) break;
    }
    return takes;
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

WRITE ${POST_SUGGESTION_VARIANT_COUNT} TAKES on that one angle, as "posts". The merchant reads them side by side and publishes ONE, so near-duplicates waste their time: the takes must differ in ANGLE OF ATTACK, not in wording. Take 1 opens on the concrete offer or fact (the figures, the date, the name). Take 2 opens on the customer's problem or question, and answers it. Take 3 opens on the outcome — what the customer walks away with. Each take stands alone as a complete post, draws on the SAME data, and obeys every rule below.

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

For EACH take also return:
- "headline": 2–5 Arabic words the platform will typeset ON the image — the poster line. The reader sees the poster and the caption AT ONCE, so the poster must not spend itself re-saying the caption's opening line.
  Test it: the headline must be a DIFFERENT KIND of line from the caption's opener. If the caption opens with a question, the headline is neither that question nor its direct answer — it is the RESULT the customer gets, or the reassurance, or the urgency. Rewording the same idea fails this test even though no words repeat.
    Caption «✨ هل تريد تحسين مهاراتك في الحاسوب؟ دورة ICDL تبدأ اليوم!»
      ✗ «دورة ICDL تبدأ اليوم» — verbatim from the caption
      ✓ «مقعدك بانتظارك» — urgency; a beat the caption never played
    Caption «❓ كيف تختار مقاس حفاضات طفلك؟»
      ✗ «اختر مقاس طفلك بسهولة» — no words repeat, but it is the same idea reworded
      ✓ «المقاس الصحيح من أول مرة» — the outcome, not the question
  No emojis, no punctuation except «!».

Then return ONE "imageBrief" for the WHOLE SET — not one per take. A single scene is photographed once and all ${POST_SUGGESTION_VARIANT_COUNT} cards are built from it, each with its own headline typeset over it. The scene must therefore fit every take: describe the ANGLE'S SUBJECT, never one take's particular hook.
- "imageBrief": one English sentence describing a photographic scene that supports the post (subject, setting, mood, colors). The scene must work WITHOUT any text, letters, or numbers, and WITHOUT people or faces — products, places, and atmosphere only.
  Draw the scene from THIS business's own world — its goods, its materials, its workplace, the result its customers get. A generic desk with a laptop is the lazy default and says nothing about the business.${recentBriefsBlock}

Return JSON: {"posts": [{"text": string, "headline": string}] (exactly ${POST_SUGGESTION_VARIANT_COUNT}), "imageBrief": string}`;
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
        const parsed = JSON.parse(content) as { imageBrief?: unknown };
        const posts = parseTakes(parsed);
        if (posts.length === 0) {
            recordAiFailedBeforeLog('post_generation', POST_TEXT_MODEL, 'AiEmptyReplyError');
            return null;
        }

        // SHADOW ONLY — it logs, it never blocks. Figure invention has NOT been
        // observed here: the one case that looked like it (2026-08-10, «45 د»)
        // was real merchant data living in `fact_rows.price`, invisible to a
        // query that selected only name/attributes. Blocking on an unobserved
        // failure would reject valid posts and burn a merchant's daily slot, so
        // this measures first. Promote to a hard gate only if the numbers say so.
        // Runs per take: one bad figure must be attributable to the take that
        // wrote it, or the merchant could publish the clean one and still see
        // the warning — or publish the bad one and see nothing.
        const corpus = buildGroundingCorpus(bundle, today);
        posts.forEach((post, index) => {
            const ungrounded = findUngroundedNumbers(post.text, corpus);
            if (ungrounded.length > 0) {
                logger.warn('[PostSuggestions] Figures absent from the prompt inputs (shadow)', {
                    pageId: bundle.pageId, postType, variantIndex: index, ungrounded,
                });
            }
        });

        return {
            posts,
            imageBrief: typeof parsed.imageBrief === 'string' ? parsed.imageBrief.trim() : '',
        };
    } catch {
        recordAiFailedBeforeLog('post_generation', POST_TEXT_MODEL, 'Other');
        return null;
    }
}

function buildImagePrompt(imageBrief: string, category?: string, mode: ImageMode = 'photo'): string {
    const forBusiness = category ? ` for a ${category} business` : '';
    if (mode === 'conceptual') {
        // Deliberately NOT a place. A business whose only room is a classroom
        // has no second scene to photograph, but it always has materials,
        // surfaces and light — so the subject shifts from WHERE to WHAT-IT-IS-
        // MADE-OF. Same hard exclusions as the photographic mode.
        return `${imageBrief}. Close-up abstract composition${forBusiness}: materials, texture, and light rather than a room or a location. Shallow depth of field, single dominant subject, generous negative space, square format. STRICT: absolutely no text, no letters, no words, no numbers, no logos, no watermarks. No people, no faces, no hands.`;
    }
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
async function generatePostImages(
    bundle: PageBundle,
    imageBrief: string,
    headlines: readonly string[],
    mode: ImageMode = 'photo',
    posterVariant = 0,
): Promise<(GeneratedImage | null)[]> {
    const none = headlines.map(() => null);
    if (!imageStorage.isConfigured()) return none;
    // A poster needs no scene, so it needs neither a brief nor an API key; the
    // photographic modes need both.
    const apiKey = config.openai?.apiKey;
    if (mode !== 'poster' && (!apiKey || !imageBrief)) return none;

    // The logo depends only on the bundle, so its fetch (up to 5s at
    // graph.facebook.com) starts NOW and runs concurrently with the image
    // call instead of adding sequential tail on a path the merchant watches
    // (Rule 17.3). A logo failure must never fail the generation: the fetch
    // resolves null on its own errors, and the extra catch pins that even if
    // its contract ever changes.
    const logoPromise: Promise<Buffer | null> = bundle.logoUrl
        ? fetchRoundedLogo(bundle.logoUrl).catch(() => null)
        : Promise.resolve(null);

    // POSTER: drawn entirely in code — no model call, no spend, no latency, and
    // no way for the model to hand back the same scene again. It then flows
    // through the SAME compositor as a photograph, so the headline typesetting,
    // logo badge, encoding and failure handling are shared, not duplicated.
    if (mode === 'poster') {
        const logo = await logoPromise;
        // Each take gets its OWN poster: the headline IS the poster, so sharing
        // one base across takes would show the same words on all of them. Free
        // to do — a poster is SVG + sharp, no model call, no spend.
        return Promise.all(headlines.map(async (headline, index) => {
            const key = `generated-posts/${bundle.workspaceId}/${randomUUID()}.jpg`;
            try {
                // The poster typesets its OWN headline, large and centred, so the
                // card's bottom-scrim headline layer is deliberately not used here.
                // Offset per take so three posters in one set differ in geometry
                // as well as in words.
                const base = await renderPosterBase(1024, 1024, posterVariant + index, headline);
                const designed = await composePostCard(base, { headline: null, logo });
                if (!designed) return null;
                return await imageStorage.put(key, designed, 'image/jpeg');
            } catch (err) {
                captureError(err, 'Post suggestion: poster composition failed', { level: 'warning', tags: { service: 'post-suggestions' }, extra: { pageId: bundle.pageId, variantIndex: index } });
                return null;
            }
        }));
    }

    // Unreachable for the photographic modes (guarded above) — present so the
    // key narrows without an assertion.
    if (!apiKey) return none;
    const client = makeTrackedOpenAI(apiKey, {
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
            prompt: buildImagePrompt(imageBrief, bundle.category, mode),
            size: POST_IMAGE_SIZE,
            quality: POST_IMAGE_QUALITY,
        }, { signal: controller.signal });
        b64 = response.data?.[0]?.b64_json;
    } catch (err) {
        // Wrapper booked failed_before_log (timeout-classified via our signal).
        captureError(err, 'Post suggestion: image generation failed', { level: 'warning', tags: { service: 'post-suggestions' }, extra: { pageId: bundle.pageId } });
        return none;
    } finally {
        clearTimeout(timer);
    }

    if (!b64) {
        // Billed response with no image payload — returns was booked, no row will follow.
        recordAiFailedBeforeLog('post_image_generation', POST_IMAGE_MODEL, 'AiEmptyReplyError');
        return none;
    }

    // ONE paid scene, N cards. The takes differ only in the headline typeset
    // over the base, and compositing is local sharp work — so a set costs
    // exactly what a single card used to. Decoded once, outside the loop: the
    // base64 payload is ~1.5 MB and re-decoding it per take is pure waste.
    const base = Buffer.from(b64, 'base64');
    const logo = await logoPromise;
    return Promise.all(headlines.map(async (headline, index) => {
        // JPEG, not PNG: photographic card with no transparency — ~10× smaller on
        // the market's mobile networks, and FB/IG accept JPEG for posts.
        const key = `generated-posts/${bundle.workspaceId}/${randomUUID()}.jpg`;
        try {
            // Compose the DESIGNED card: brand scrim + typeset Arabic headline +
            // logo badge (deterministic sharp layers, zero AI cost, best-effort —
            // any LAYER failure ships whatever composed cleanly; an undecodable
            // BASE returns null and that take degrades to text-only).
            const designed = await composePostCard(base, { headline, logo });
            if (!designed) return null;
            return await imageStorage.put(key, designed, 'image/jpeg');
        } catch (err) {
            captureError(err, 'Post suggestion: image upload failed', { tags: { service: 'post-suggestions' }, extra: { pageId: bundle.pageId, key, variantIndex: index } });
            return null;
        }
    }));
}

function toDto(row: typeof postSuggestions.$inferSelect): PostSuggestionDto {
    const variants = variantsOf(row);
    // Clamp: a selection can only be stored through the select route, which
    // validates against the row's own length — but a hand-edited row must not
    // be able to hand the client an index its `variants` array cannot serve.
    const selected = row.selectedVariant >= 0 && row.selectedVariant < variants.length ? row.selectedVariant : 0;
    return {
        id: row.id,
        status: (row.status === 'pending' || row.status === 'failed' ? row.status : 'ready') as PostSuggestionStatus,
        ...(row.imageDegraded ? { imageDegraded: row.imageDegraded as PostSuggestionImageDegraded } : {}),
        text: row.text,
        imageUrl: row.imageUrl,
        // imageKey is a storage handle, never client-facing.
        variants: variants.map(({ text, headline, imageUrl }) => ({ text, headline, imageUrl })),
        selectedVariant: selected,
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
     * The page's CURRENT post, what is in flight, and the earlier posts.
     *
     * ⭐ `suggestion` is always a READY row. It used to be "the newest row of
     * any live status", which conflated the post the merchant HAS with the
     * attempt that is HAPPENING — and a failed attempt is newer than the post
     * it did not replace, so it took its place. Day-scoped that cleared at
     * midnight; on-demand nothing clears it, so the post stayed masked (and
     * unreachable via `history`, which is superseded rows only) and a page
     * whose one-time seed failed showed an empty card forever. The two
     * questions are answered separately now — see `PostSuggestionInFlight`.
     *
     * ⚠️ Deliberately NOT scoped to today. It used to be, because a cron wrote a
     * post every morning and the calendar day was the unit of the product. With
     * generation on demand (owner ruling 2026-08-13) nothing arrives on its own
     * after the first seed, so a day-scoped read would show an EMPTY sheet to
     * every merchant who last created a post before midnight — and nothing
     * would ever fill it. A merchant's posts are the page's, not the day's.
     *
     * The daily CAP below is still per-day; that boundary did not move. The day
     * stopped deciding what a merchant can SEE, not how much they can MAKE.
     *
     * Null when the page doesn't belong to this workspace — the caller 404s, and
     * ownership resolves BEFORE the cap read so a foreign page never even leaks
     * its counter. The same page row feeds computeAvailableTypes, so KB/profile
     * are fetched exactly once.
     */
    async getCurrent(workspaceId: string, pageId: string): Promise<{ suggestion: PostSuggestionDto | null; inFlight: PostSuggestionInFlight | null; remainingToday: number | null; availableTypes: PostSuggestionPostType[]; history: PostSuggestionHistoryItem[] } | null> {
        const today = todayIso();
        const page = await fetchOwnedPage(workspaceId, pageId);
        if (!page) return null;

        // Ownership is established above, so no pages join — and no
        // materializing the full pages row (KB text, accessToken) per card fetch.
        //
        // ⭐ Four INDEPENDENT reads, so they cost one round trip rather than
        // four (Rule 17.3 — never a sequential hop where a parallel one works).
        // This runs on every dashboard render of the card, which is the
        // highest-frequency fetch the feature has; the row reads are served by
        // idx_post_suggestions_page_created, added with this split because
        // dropping the day scope left `suggested_for` — the only indexed
        // discriminator either query had — out of both of them.
        const [current, inFlight, history, remainingToday] = await Promise.all([
            readCurrentPost(pageId),
            readInFlight(pageId),
            readPostHistory(pageId),
            this.readRemainingToday(pageId, today),
        ]);
        const availableTypes = await computeAvailableTypes(page, today);
        return { suggestion: current ? toDto(current) : null, inFlight, remainingToday, availableTypes, history };
    }

    /**
     * Slots left today, or NULL when the cap store cannot say.
     *
     * Null is UNKNOWN, never 0 — a false "exhausted" would hide the create UI
     * for the duration of a Redis incident, and the generate path fails closed
     * on its own anyway. Captured (fingerprinted) so an incident on the
     * highest-frequency cap read stays visible instead of silently degrading.
     */
    private async readRemainingToday(pageId: string, today: string): Promise<number | null> {
        try {
            // Same arithmetic the WRITE path enforces — see readCapStatus. A
            // number this method reports is a promise the card makes on the
            // server's behalf, so it must be the server's own number.
            const cap = await readCapStatus(pageId, today, config.postSuggestions.dailyCapPerPage);
            return Math.max(0, cap.limit - cap.used);
        } catch (err) {
            captureError(err, 'Post suggestion: getCurrent cap read failed', {
                level: 'warning',
                tags: { service: 'post-suggestions' },
                fingerprint: ['post-suggestions-cap-read'],
                extra: { pageId },
            });
            return null;
        }
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
    async requestSuggestion(workspaceId: string, pageId: string, source: 'cron' | 'manual', opts?: { includeContact?: boolean; postType?: PostSuggestionPostType }): Promise<GenerateResult> {
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
        let cap: { used: number; limit: number; allowed: boolean };
        try {
            // Shared with the read path so the card can never advertise an
            // attempt this block will refuse. Either source failing → fail
            // closed (dailyCap contract).
            cap = await readCapStatus(pageId, today, limit);
        } catch (err) {
            captureError(err, 'Post suggestion: cap check unavailable', { tags: { service: 'post-suggestions' }, extra: { pageId } });
            return { ok: false, reason: 'cap_check_unavailable' };
        }
        if (!cap.allowed) {
            return { ok: false, reason: 'daily_cap', cap: { allowed: false, used: cap.used, limit } };
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

        // The paid work does NOT run here. Generation takes ~35s — seven times
        // the 5s past which the industry standard says return at once and
        // notify — and nginx caps this route at 30s, so a synchronous shape
        // could only ever fail in front of the merchant. It did, in production,
        // on 2026-08-12: the socket closed at 35.25s, the post was created
        // anyway, and they were shown «حدث خطأ ما» with a slot already spent.
        //
        // So the request stores a PENDING row — its cap slot already claimed
        // above — and hands the work to the worker. What the merchant gets back
        // is a real, addressable post that simply is not written yet.
        const [pending] = await db.insert(postSuggestions).values({
            pageId,
            suggestedFor: today,
            source,
            // The REQUESTED angle. The worker overwrites it with the angle
            // actually used, which may be downgraded when the page's data
            // cannot deliver what was asked for.
            postType: opts?.postType ?? null,
            // A pending row has nothing to show yet. `text` is NOT NULL, so it
            // holds the empty string rather than a placeholder sentence — a
            // fake body would be copied by any client that ignores `status`.
            text: '',
            status: 'pending',
        }).onConflictDoNothing({
            target: [postSuggestions.pageId, postSuggestions.suggestedFor],
            // Matches uq_post_suggestions_cron_once's predicate so Postgres
            // infers the partial unique index as the arbiter.
            where: sql`source = 'cron'`,
        }).returning();

        // onConflictDoNothing only ever suppresses the CRON insert (partial
        // unique index): the sibling deploy already claimed today's row.
        if (!pending) {
            const existing = await this.getCurrent(workspaceId, pageId);
            if (existing?.suggestion || existing?.inFlight) {
                return { ok: true, suggestion: existing.suggestion, inFlight: existing.inFlight, remainingToday: existing.remainingToday, availableTypes: existing.availableTypes };
            }
            return { ok: false, reason: 'generation_failed' };
        }

        // The cron is ALREADY off the request path, so it fulfils inline and
        // keeps reporting real per-page outcomes in its counters. Only the
        // merchant-facing path needs the queue — and it is the only one that
        // was ever timing out.
        if (source === 'cron') {
            await this.fulfilSuggestion(pending.id, { includeContact: opts?.includeContact !== false });
        } else {
            try {
                // The requested angle is NOT on the job: it is already on the
                // row, and fulfilment reads it from there — one source, and no
                // way for a replayed job to ask for a different angle than the
                // row the merchant's slot actually bought.
                await enqueuePostSuggestion({
                    suggestionId: pending.id,
                    pageId,
                    includeContact: opts?.includeContact !== false,
                });
            } catch (err) {
                // The queue is down. Mark the row failed rather than leaving it
                // pending forever: the merchant's slot is spent either way, and
                // a visible failure is the only honest report of that.
                captureError(err, 'Post suggestion: enqueue failed', { tags: { service: 'post-suggestions' }, extra: { pageId, suggestionId: pending.id } });
                await db.update(postSuggestions)
                    .set({ status: 'failed', failureReason: 'enqueue_failed', fulfilledAt: new Date() })
                    .where(eq(postSuggestions.id, pending.id));
                return { ok: false, reason: 'generation_failed' };
            }
        }

        // Re-read: the cron path has already filled the row in, and the queued
        // path may have too if the worker was quick. Either way the client gets
        // the row's CURRENT state rather than a stale pending snapshot.
        const [current] = await db.select().from(postSuggestions)
            .where(eq(postSuggestions.id, pending.id)).limit(1);
        const settled = current ?? pending;

        // One envelope across routes: same split, same availability list
        // getCurrent serves. A row that is already `ready` (the inline seed
        // path, or a very fast worker) IS the post; anything else is in flight
        // and the merchant keeps looking at the post they already had — which
        // is why the previous one is read rather than sending them null.
        //
        // ⛔ History is deliberately NOT returned here. This route answers with
        // a PENDING row — the worker supersedes the previous post seconds
        // later — so any list built now is one behind by construction, and the
        // client is already polling getCurrent, which answers correctly. Sending
        // a knowingly-stale list would buy a paid-path query for a value the
        // very next request overwrites.
        const settledIsPost = settled.status === 'ready';
        const [previous, availableTypes] = await Promise.all([
            settledIsPost ? Promise.resolve(null) : readCurrentPost(pageId),
            computeAvailableTypes(page, today),
        ]);

        // Counting the slot this request just consumed. `cap.used` is already
        // the stricter of the counter and the durable row count (readCapStatus),
        // so there is no second view left to take a max against.
        const remaining = Math.max(0, limit - (cap.used + 1));
        return {
            ok: true,
            suggestion: settledIsPost ? toDto(settled) : (previous ? toDto(previous) : null),
            inFlight: settledIsPost ? null : { id: settled.id, status: settled.status as 'pending' | 'failed' },
            remainingToday: remaining,
            availableTypes,
        };
    }

    /**
     * Do the paid work for a pending row and drive it to a terminal state.
     *
     * Runs in the worker (or inline for the cron). It ALWAYS finishes the row:
     * 'ready' with its takes, or 'failed' with a reason. Never leaving it
     * pending is the contract that makes the merchant's spent slot honest — a
     * row stuck pending reads as "still working" forever.
     */
    async fulfilSuggestion(suggestionId: string, opts?: { includeContact?: boolean }): Promise<void> {
        const [row] = await db.select().from(postSuggestions)
            .where(eq(postSuggestions.id, suggestionId)).limit(1);
        if (!row) return;
        // Anything already terminal is left alone: a duplicated job (redeploy,
        // manual replay) must never regenerate — and re-pay for — a finished row.
        if (row.status !== 'pending') return;

        const fail = async (reason: string) => {
            await db.update(postSuggestions)
                .set({ status: 'failed', failureReason: reason, fulfilledAt: new Date() })
                .where(eq(postSuggestions.id, suggestionId));
        };

        try {
            const page = await fetchPageById(row.pageId);
            if (!page?.userId || !page.workspaceId) return await fail('page_not_found');

            const today = row.suggestedFor;
            const bundle = await buildPageBundle(page, page.userId, page.workspaceId, today);

            // Latest suggestion from ANY day: the variety picker must see
            // yesterday's angle, or the cron (always the first row of its day)
            // would open on the same first candidate every single morning. The
            // pending row itself is excluded — it has no angle of its own yet.
            const recent = await db.select({
                postType: postSuggestions.postType,
                imageBrief: postSuggestions.imageBrief,
                imageMode: postSuggestions.imageMode,
            }).from(postSuggestions)
                .where(and(
                    eq(postSuggestions.pageId, row.pageId),
                    ne(postSuggestions.id, suggestionId),
                    // Only rows that actually PRODUCED a post carry a usable
                    // angle and scene. A pending or failed row's `post_type` is
                    // whatever was requested (often null) and its brief is
                    // empty, so letting either in here would make the variety
                    // memory forget a real post because a later one failed.
                    // 'superseded' stays in: it was a real post before it was
                    // replaced, and legacy rows are all 'ready'.
                    inArray(postSuggestions.status, ['ready', 'superseded']),
                ))
                .orderBy(desc(postSuggestions.createdAt))
                .limit(RECENT_BRIEF_WINDOW);
            const previous = recent[0];
            const recentImageBriefs = recent
                .map(r => r.imageBrief?.trim())
                .filter((b): b is string => Boolean(b));

            // Merchant-chosen angle wins ONLY when the page's data can actually
            // deliver it — validated against the SAME flags the picker consumes
            // (fetched-catalog truth, not the cheap advertisement). Unavailable
            // ⇒ DOWNGRADE to the variety picker rather than fail: the cap slot
            // is already claimed, and a generated post beats burning it on an
            // error. The row records the type actually used.
            const requested = row.postType as PostSuggestionPostType | null;
            const deliverable = candidateTypes(computeAvailabilityFlags(bundle));
            const postType = requested && (requested === 'general' || deliverable.includes(requested))
                ? requested
                : pickPostType(bundle, previous?.postType ?? null);
            if (requested && postType !== requested) {
                logger.info('[PostSuggestions] Requested angle unavailable — downgraded to variety picker', { pageId: row.pageId, requested, used: postType });
            }

            const generated = await generatePostText(bundle, postType, today, recentImageBriefs);
            if (!generated) return await fail('generation_failed');

            // Deterministic contact footer — appended in code, never model-written.
            // Carried on the JOB, not the row: it is a property of the request,
            // and a column for it would be one more thing to keep in step.
            const includeContact = opts?.includeContact !== false;
            const withContact = (text: string) => includeContact && bundle.contactSuffix
                ? `${text}\n\n${bundle.contactSuffix}`
                : text;

            // Rotate the KIND of image off the last one. `recent.length` only
            // varies the poster's geometry, never which mode is chosen.
            const imageMode = pickImageMode(previous?.imageMode);
            const images = await generatePostImages(
                bundle, generated.imageBrief, generated.posts.map(p => p.headline), imageMode, recent.length,
            );
            const variants: PostSuggestionVariantRow[] = generated.posts.map((post, index) => ({
                text: withContact(post.text),
                headline: post.headline || null,
                imageUrl: images[index]?.url ?? null,
                imageKey: images[index]?.key ?? null,
            }));

            // Why this generation has no image, decided once and STORED. The
            // request that triggered it has long returned by the time we get
            // here, so a reason returned instead of recorded would reach nobody.
            const imageDegraded: PostSuggestionImageDegraded | null = variants.some(v => v.imageUrl)
                ? null
                : (imageStorage.isConfigured() ? 'image_failed' : 'storage_off');

            // Fill THIS row in, then mark the previous one as an earlier post —
            // in one transaction. Gated on `status = 'ready'` on both sides: a
            // pending row must never displace the post the merchant is currently
            // looking at, because it has nothing to show instead yet. That is
            // the async version of the same invariant the synchronous code kept
            // by inserting before superseding.
            await db.transaction(async (tx) => {
                await tx.update(postSuggestions).set({
                    postType,
                    variants,
                    selectedVariant: 0,
                    text: variants[0].text,
                    imageUrl: variants[0].imageUrl,
                    imageKey: variants[0].imageKey,
                    // Stored even when the image call failed: the brief is what
                    // the NEXT generation must avoid repeating.
                    imageBrief: generated.imageBrief || null,
                    // Recorded even when the image failed: the next card rotates
                    // off the mode we ATTEMPTED, or a failing mode repeats daily.
                    imageMode,
                    imageDegraded,
                    status: 'ready',
                    fulfilledAt: new Date(),
                }).where(eq(postSuggestions.id, suggestionId));

                // NOT scoped to a day: with generation on demand there is
                // exactly ONE current post per page at a time, and the one it
                // replaces may well have been made last week.
                //
                // ⛔ The images are KEPT. This used to null imageUrl/imageKey on
                // the row and on every take, then delete the files from storage.
                // That destroyed the merchant's work — production, 11 Aug: three
                // attempts, the first was the best, the third erased it — and it
                // was backwards economically, since an image costs ~$0.0064 to
                // generate and a fraction of a cent a year to store. `superseded`
                // now means "an earlier post, intact", not "replaced and gutted".
                const previous = await tx.select({ id: postSuggestions.id })
                    .from(postSuggestions)
                    .where(and(
                        eq(postSuggestions.pageId, row.pageId),
                        eq(postSuggestions.status, 'ready'),
                        ne(postSuggestions.id, suggestionId),
                    ));
                if (previous.length > 0) {
                    await tx.update(postSuggestions)
                        .set({ status: 'superseded' })
                        .where(inArray(postSuggestions.id, previous.map(p => p.id)));
                }
            });
        } catch (err) {
            captureError(err, 'Post suggestion: fulfilment failed', { tags: { service: 'post-suggestions' }, extra: { suggestionId } });
            await fail('generation_failed');
        }
    }

    /**
     * The bytes of one take's card, for serving from our OWN origin.
     *
     * ⛔ The storage key is DERIVED here from (workspace, page, suggestion,
     * index) and never accepted from the caller. A route that took a key or a
     * URL would be an arbitrary-object read of the whole bucket — every
     * merchant's images — behind one authenticated session, and an SSRF if it
     * took a URL. The client may only say WHICH TAKE it wants.
     *
     * Null covers every "you get a 404" case without distinguishing them:
     * not this workspace's row, no such take, or the file is gone (a superseded
     * post's images are deleted by design). Telling those apart would leak
     * whether a row exists.
     */
    async getVariantImage(
        workspaceId: string, pageId: string, suggestionId: string, variantIndex?: number,
    ): Promise<{ body: Buffer; contentType: string; filename: string } | null> {
        const [row] = await db.select()
            .from(postSuggestions)
            .innerJoin(pages, eq(pages.id, postSuggestions.pageId))
            .where(and(
                eq(postSuggestions.id, suggestionId),
                eq(postSuggestions.pageId, pageId),
                eq(pages.workspaceId, workspaceId),
            ))
            .limit(1);
        if (!row) return null;

        const suggestion = row.post_suggestions;
        const variants = variantsOf(suggestion);
        // Absent index = whichever take the merchant currently has selected,
        // which is what the sheet is showing them.
        const index = variantIndex ?? suggestion.selectedVariant;
        if (!Number.isInteger(index) || index < 0 || index >= variants.length) return null;

        const key = variants[index].imageKey;
        if (!key) return null;
        const object = await imageStorage.get(key);
        if (!object) return null;

        return {
            body: object.body,
            contentType: object.contentType || 'image/jpeg',
            // Dated, not id-named: the merchant is saving "my post for the 12th"
            // to their phone, and a uuid filename is meaningless there.
            filename: `jawab24-post-${suggestion.suggestedFor}.jpg`,
        };
    }

    /**
     * Resolve a row whose job died before `fulfilSuggestion` could report on
     * it. Called only from the worker's `failed` handler — the last chance to
     * keep the promise that a claimed slot always ends in something visible.
     *
     * Guarded on `status = 'pending'` in the WHERE, so it can never overwrite a
     * row that did finish (the handler also fires for post-completion errors).
     */
    async markFulfilmentAbandoned(suggestionId: string): Promise<void> {
        await db.update(postSuggestions)
            .set({ status: 'failed', failureReason: 'worker_abandoned', fulfilledAt: new Date() })
            .where(and(eq(postSuggestions.id, suggestionId), eq(postSuggestions.status, 'pending')));
    }

    /**
     * Persist which take the merchant picked, and mirror it into the columns of
     * record so every reader — shipped app bundles, the dashboard card, SQL —
     * sees the chosen post without knowing what a variant is.
     *
     * Returns null when the row isn't visible to this workspace (caller 404s)
     * or the index doesn't address a take this row actually has.
     */
    async selectVariant(workspaceId: string, pageId: string, suggestionId: string, variantIndex: number): Promise<PostSuggestionDto | null> {
        const [row] = await db.select()
            .from(postSuggestions)
            .innerJoin(pages, eq(pages.id, postSuggestions.pageId))
            .where(and(
                eq(postSuggestions.id, suggestionId),
                eq(postSuggestions.pageId, pageId),
                eq(pages.workspaceId, workspaceId),
            ))
            .limit(1);
        if (!row) return null;

        const suggestion = row.post_suggestions;
        const variants = variantsOf(suggestion);
        if (!Number.isInteger(variantIndex) || variantIndex < 0 || variantIndex >= variants.length) return null;
        const chosen = variants[variantIndex];

        const [updated] = await db.update(postSuggestions)
            .set({
                selectedVariant: variantIndex,
                text: chosen.text,
                imageUrl: chosen.imageUrl,
                imageKey: chosen.imageKey,
            })
            .where(eq(postSuggestions.id, suggestionId))
            .returning();
        return updated ? toDto(updated) : null;
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
     * Seed the FIRST post for pages that have never had one — and only those.
     *
     * ⚠️ This replaced a daily pre-generation cron (owner ruling 2026-08-13,
     * «ما عاد ملزمين نولد بوست كل يوم»). A merchant now meets the feature with a
     * finished post already in it, so it demonstrates itself instead of
     * explaining itself — and we pay for that ONCE per page instead of every
     * morning forever. Every post after the first is generated on demand.
     *
     * The seed predicate is "this page has no rows at all", which makes repeat
     * spend structurally impossible rather than merely guarded (Rule 14): rows
     * are never deleted, so once a page is seeded it can never be seeded again.
     * That is why the whole unopened-streak waste guard is gone with the cron —
     * it existed to stop a daily job dripping spend on a merchant who never
     * looked, and there is no longer a daily job.
     *
     * It still runs on a schedule, because eligibility ARRIVES over time: a page
     * connects, a workspace is added to the allowlist. The sweep is how those
     * pages get their first post without a separate event hook.
     *
     * STRICTER than the endpoint gate on purpose — an unprompted generation is
     * spend no user asked for, so an EMPTY workspace allowlist seeds nothing
     * even when the feature is enabled fleet-wide.
     *
     * A seed that FAILS is not retried: the row exists, so the predicate is
     * false forever after. That is deliberate — the merchant lands on the
     * generate button, which is the whole model, and an automatic retry loop is
     * exactly the unattended spend this change removes.
     */
    async seedFirstPostSuggestions(): Promise<{ eligible: number; seeded: number; skippedExisting: number; failed: number }> {
        const startedAt = Date.now();
        const result = { eligible: 0, seeded: 0, skippedExisting: 0, failed: 0 };
        const workspaceIds = config.postSuggestions.workspaceIds;
        if (!config.postSuggestions.enabled || workspaceIds.length === 0) {
            // The most common healthy state must still leave a trace — an
            // empty allowlist is otherwise log-identical to "never fired".
            logger.info('[PostSuggestions] Seed sweep skipped — feature disabled or workspace allowlist empty');
            return result;
        }

        // Connected pages only — a page without a token can't be posted to,
        // so seeding it is guaranteed waste.
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
                // Status-blind and day-blind: ANY row means this page has met
                // the feature already, so it is never seeded again.
                const [existing] = await db.select({ id: postSuggestions.id }).from(postSuggestions)
                    .where(eq(postSuggestions.pageId, pageId)).limit(1);
                if (existing) { result.skippedExisting++; continue; }

                const generated = await this.requestSuggestion(page.workspaceId, pageId, 'cron');
                // `ok` only means the REQUEST succeeded. The seed fulfils
                // inline, and fulfilment reports failure by driving the row to
                // 'failed' rather than by throwing — so counting `ok` alone
                // would book every failed generation as a success and make
                // these counters, the only per-page signal this job has, lie.
                // Nothing in flight after an INLINE fulfilment is exactly "the
                // row became the post"; a failed one comes back as inFlight.
                if (generated.ok && !generated.inFlight && generated.suggestion) {
                    result.seeded++;
                    logger.info('[PostSuggestions] Seeded first post', { pageId, postType: generated.suggestion.postType });
                } else {
                    result.failed++;
                    logger.warn('[PostSuggestions] Seed generation failed', {
                        pageId,
                        reason: generated.ok ? `status:${generated.inFlight?.status ?? 'no_post'}` : generated.reason,
                    });
                }
            } catch (err) {
                result.failed++;
                captureError(err, 'Post suggestion seed failed for page', { tags: { service: 'post-suggestions' }, extra: { pageId } });
            }
        }

        // Positive heartbeat + split counters (mirrors [LeadDigest]): "ran,
        // nothing to do" must be distinguishable from "never ran" and from
        // "ran and failed" in the production log.
        logger.info('[PostSuggestions] Seed sweep complete', { ...result, durationMs: Date.now() - startedAt });
        return result;
    }
}

export const postSuggestionsService = new PostSuggestionsService();
