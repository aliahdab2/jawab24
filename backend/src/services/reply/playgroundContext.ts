import { settingsService } from '../settings';
import { workspaceSettingsService } from '../workspaceSettings';
import { getEnrichedKnowledgeBase, getStoreContextForAI } from '../ecommerce';
import { catalogService } from '../catalog';
import { factCollectionsService } from '../factCollections';
import { composeFactMatchText } from '../factCollectionsMatcher';
import { captureError } from '../../utils/sentryHelpers';
import { pickNudgeVariation } from './nudge';
import { resolveBrandVoiceNotes } from './contextEnricher';
import { detectLanguageCode } from '../../utils/language';
import type { PlaygroundInput } from './generator';
import { pages } from '../../db/schema';
import type { FacebookMessageTag } from '../../utils/commentText';
import type { PlaygroundSource } from '../../types/aiPipeline';
import {
    formatBusinessInfoPrompt,
    unwrapBusinessProfile,
    type StoredBusinessProfile,
} from '@jawab24/shared';

/** Minimal page shape needed to build playground context */
/**
 * The `pages` columns a playground/eval/cache-warm context needs — the single
 * definition BOTH column-subset selects spread (`admin/kb.ts` preview and
 * `scripts/warm-reply-cache.ts`). A prompt-relevant column added to the schema
 * gets added HERE, and both paths inherit it; before this constant each select
 * hand-listed its columns, and a column missed in one produced a preview or a
 * warmed `bv:` cache key that silently disagreed with production (the drift
 * this PR's own comments warn about). Pinned by cacheWarming.test.ts.
 */
export const PLAYGROUND_PAGE_COLUMNS = {
    id: pages.id,
    name: pages.name,
    userId: pages.userId,
    workspaceId: pages.workspaceId,
    knowledgeBase: pages.knowledgeBase,
    kbActiveVersion: pages.kbActiveVersion,
    ecommerceStoreId: pages.ecommerceStoreId,
    businessProfile: pages.businessProfile,
    brandVoiceNotesMulti: pages.brandVoiceNotesMulti,
} as const;

export interface PlaygroundPageData {
    id: string;
    name?: string | null;
    userId?: string | null;
    workspaceId: string | null;
    knowledgeBase?: string | null;
    kbActiveVersion?: number | null;
    ecommerceStoreId?: string | null;
    /** Stage 2.6: needed to build the structured BUSINESS_INFO prompt block. */
    businessProfile?: unknown;
    /** Per-page persona override (D-084) — resolved exactly like production. */
    brandVoiceNotesMulti?: Record<string, string> | null;
}

interface PlaygroundContextOptions {
    page: PlaygroundPageData;
    question: string;
    channel: 'comment' | 'dm';
    postMessage?: string;
    /** Facebook `message_tags` array for comment tests — used to reproduce the
     *  friend-tag skip rule in the playground. Only meaningful when channel === 'comment'. */
    messageTags?: FacebookMessageTag[];
    /** Our own Facebook page ID — required to distinguish page-tags pointing at us
     *  (reply) from page-tags pointing elsewhere (skip). */
    ourFacebookPageId?: string;
    /** Prior turns of the thread (DM only). Supplied by BOTH the admin playground and
     *  the customer-facing test reply. */
    conversationHistory?: { role: 'user' | 'assistant'; content: string }[];
    /**
     * Merchant persona and tone — OPTIONAL overrides, NOT admin-only inputs.
     *
     * When a caller omits them (the customer-facing test reply always does), they fall
     * back to the values stored on the page's workspace, resolved the way production
     * resolves them. They were originally modelled as admin experiment inputs with no
     * fallback, which made the merchant's own «اختبار الرد الذكي» demo a reply their
     * customers would never receive. An explicitly supplied value always wins, so the
     * admin playground can still try a persona the merchant has not saved.
     */
    replyStyle?: string;
    brandVoiceNotes?: string;
    /** Admin-only experiment input: a synthetic returning-customer summary. The production
     *  DM pipeline derives its own from conversation history inside the generator, so there
     *  is no stored merchant value to fall back to. */
    customerContext?: string;
    /** Customer display name (DM only) — feeds gender-aware Arabic DM addressing. */
    senderName?: string;
    /** Minutes since the previous thread message (DM only) — exercises the time-gap fact line. */
    minutesSinceLastMessage?: number;
    model?: string;
    /** 'eval' for the batch eval script, 'playground' (default) for interactive admin testing.
     *  Set as the pipeline tag on ai_usage_log so eval cost is queryable separately. */
    source?: PlaygroundSource;
}

export interface PlaygroundContext {
    playgroundInput: PlaygroundInput;
    commentReplyMode: 'public' | 'private' | 'dual';
    nudgeText: string | null;
}

/**
 * Builds the full context needed to call replyGenerator.generateForPlayground().
 * Shared between the admin playground route and the customer-facing test-reply endpoint.
 */
export async function buildPlaygroundContext(opts: PlaygroundContextOptions): Promise<PlaygroundContext> {
    const { page, question, channel, postMessage, messageTags, ourFacebookPageId, conversationHistory, replyStyle, brandVoiceNotes, customerContext, senderName, minutesSinceLastMessage, model, source } = opts;

    // 1. Fetch owner settings for comment reply mode + workspace settings for the
    //    language fallback and the merchant's stored persona.
    let commentReplyMode: 'public' | 'private' | 'dual' = 'public';
    let nudgeText: string | null = null;
    let defaultReplyLanguage: string | undefined;
    let timezone: string | undefined;
    if (page.userId) {
        try {
            const ownerSettings = await settingsService.getSettings(page.userId);
            commentReplyMode = ownerSettings.commentReplyMode || 'public';
            if (commentReplyMode === 'dual') {
                const qLang = detectLanguageCode(question);
                nudgeText = pickNudgeVariation(
                    ownerSettings.dualReplyNudgeVariations as Record<string, string[]> | undefined,
                    qLang,
                );
            }
        } catch {
            // Non-critical — fall back to defaults
        }
    }
    // The merchant's stored persona and tone, used ONLY when the caller passes none.
    // The playground used to take them from the request body alone, so a merchant testing
    // their own page got a reply built WITHOUT their persona and always in the default
    // "professional" tone. That made the playground a poor witness for exactly the settings
    // it is meant to demonstrate — a named persona («سارة») never introduced itself there,
    // and the 10 merchants on casual/enthusiastic were previewed at the wrong tone.
    //
    // Both are read from the PAGE'S OWN WORKSPACE, because that is the store production
    // reads: messageProcessor and commentProcessor refuse a page with no workspace outright
    // and then call workspaceSettingsService.getSettings(page.workspaceId). The owner row is
    // NOT a substitute — settingsService.getSettings overlays the pipeline fields from
    // resolveWorkspaceId(userId), an unordered `limit(1)` over the user's memberships, so a
    // merchant who holds more than one workspace (a personal one beside a store one, which
    // D-066 Zid installs auto-provision) can be previewed with another workspace's persona.
    //
    // resolveBrandVoiceNotes is production's own resolver (it picks the language variant
    // matching the customer's message), imported rather than re-implemented so the two
    // paths cannot drift — the same single-choke-point rule the language work follows.
    let storedBrandVoiceNotes: string | undefined;
    let storedReplyStyle: string | undefined;
    if (page.workspaceId) {
        try {
            const wsSettings = await workspaceSettingsService.getSettings(page.workspaceId);
            defaultReplyLanguage = wsSettings.defaultReplyLanguage;
            timezone = wsSettings.timezone;
            // Page override → workspace default (D-084) — the same third argument
            // production's enrichPageContext passes, so playground/eval/cache-warm
            // previews resolve the persona exactly like the reply pipeline.
            storedBrandVoiceNotes = resolveBrandVoiceNotes(wsSettings, question, page.brandVoiceNotesMulti);
            storedReplyStyle = wsSettings.replyStyle || undefined;
        } catch {
            // Non-critical — fall back to default
        }
    }
    // An explicit caller value still wins: the admin console and the eval harness pass a
    // persona per request to try one the merchant has not saved.
    const effectiveBrandVoiceNotes = brandVoiceNotes ?? storedBrandVoiceNotes;
    const effectiveReplyStyle = replyStyle ?? storedReplyStyle;

    // 2. Enrich KB with e-commerce product/policy data
    let pageKB = page.knowledgeBase || undefined;
    let storePolicies: string | undefined;
    let productCatalog: string | undefined;
    if (page.ecommerceStoreId) {
        try {
            pageKB = await getEnrichedKnowledgeBase(pageKB, page.ecommerceStoreId);
            const storeCtx = await getStoreContextForAI(page.ecommerceStoreId);
            storePolicies = storeCtx.storePolicies;
            productCatalog = storeCtx.productCatalog;
        } catch {
            // Non-critical — fall back to raw KB
        }
    } else {
        // Store-less pages: manual catalog_items fill the same <product_catalog>
        // block — mirrors contextEnricher so playground/test-reply and production
        // stay in sync (same rule as commentPreprocess).
        try {
            productCatalog = await catalogService.buildCatalogPromptBlock(page.id);
        } catch (err) {
            // Non-critical — the test reply proceeds without the block; logged
            // so playground and production failures are equally visible.
            captureError(err, 'Catalog prompt block failed (playground)', { level: 'warning', tags: { service: 'catalog' }, extra: { pageId: page.id } });
        }
    }

    // 2a2. G1a fact collections — built for EVERY page (store or not), same as
    //      contextEnricher. Without this the eval/playground would test the
    //      product path with the coverage statement missing, i.e. it would grade a
    //      prompt production never sends (the reason #737 must gate the rendered
    //      block, not a hand-written KB line).
    let factCollectionsBlock: string | undefined;
    let factCollectionsGated = false;
    try {
        // DMs match against the caller-supplied history's USER turns + the current
        // question, mirroring the production pipeline (messageProcessor composes the
        // same via composeFactMatchText) — an eval probe that states the area in a
        // prior turn must exercise the same gate production applies. Comments have
        // no history, same as production.
        const matchText = channel === 'dm'
            ? composeFactMatchText(conversationHistory, question)
            : question;
        const facts = await factCollectionsService.buildFactCollectionsContext(page.id, matchText);
        factCollectionsBlock = facts.block;
        factCollectionsGated = facts.gated;
    } catch (err) {
        captureError(err, 'Fact collections prompt block failed (playground)', { level: 'warning', tags: { service: 'factCollections' }, extra: { pageId: page.id } });
    }

    // 2b. Stage 2.6 structured BUSINESS_INFO block — built from merchant half only,
    //     gated by provenance so unconfirmed FB-sync values don't override KB text.
    const { merchant, merchantProvenance } = unwrapBusinessProfile(page.businessProfile as StoredBusinessProfile);
    const businessInfoBlock = formatBusinessInfoPrompt(merchant ?? null, merchantProvenance);

    // 3. When comment mode is dual or private, use DM channel for detailed reply
    const effectiveChannel: 'comment' | 'dm' = (channel === 'comment' && (commentReplyMode === 'dual' || commentReplyMode === 'private'))
        ? 'dm'
        : channel;

    // 4. Build PlaygroundInput
    const playgroundInput: PlaygroundInput = {
        pageId: page.id,
        userId: page.userId ?? undefined,
        workspaceId: page.workspaceId,
        question,
        channel: effectiveChannel,
        // Preserve the channel the user actually tested. The generator keys comment
        // preprocessing + comment-language resolution off this, so a comment test on a
        // dual/private merchant (flattened to effectiveChannel='dm' above) still mirrors
        // the post language instead of falling back to the raw comment's script.
        requestedChannel: channel,
        knowledgeBase: pageKB,
        kbActiveVersion: page.kbActiveVersion,
        pageName: page.name ?? undefined,
        productCatalog,
        storePolicies,
        factCollectionsBlock,
        factCollectionsGated,
        // Forwarded for BOTH channels: the DM pipeline injects the origin post + the
        // merchant's Post Reply as [current_post] for comment-originated threads, so the
        // playground/eval must be able to exercise the dm+postMessage combination too.
        postMessage: postMessage,
        conversationHistory: channel === 'dm' ? conversationHistory : undefined,
        senderName: channel === 'dm' ? senderName : undefined,
        minutesSinceLastMessage: channel === 'dm' ? minutesSinceLastMessage : undefined,
        replyStyle: effectiveReplyStyle,
        brandVoiceNotes: effectiveBrandVoiceNotes,
        businessInfoBlock,
        customerContext,
        model,
        defaultReplyLanguage,
        timezone,
        messageTags: channel === 'comment' ? messageTags : undefined,
        ourFacebookPageId: channel === 'comment' ? ourFacebookPageId : undefined,
        ecommerceStoreId: page.ecommerceStoreId ?? undefined,
        pipeline: source === 'eval' ? 'eval' : 'playground',
    };

    return { playgroundInput, commentReplyMode, nudgeText };
}
