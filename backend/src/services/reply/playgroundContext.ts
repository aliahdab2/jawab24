import { settingsService } from '../settings';
import { workspaceSettingsService } from '../workspaceSettings';
import { getEnrichedKnowledgeBase, getStoreContextForAI } from '../ecommerce';
import { catalogService } from '../catalog';
import { factCollectionsService } from '../factCollections';
import { composeFactMatchText } from '../factCollectionsMatcher';
import { captureError } from '../../utils/sentryHelpers';
import { pickNudgeVariation } from './nudge';
import { detectLanguageCode } from '../../utils/language';
import type { PlaygroundInput } from './generator';
import type { FacebookMessageTag } from '../../utils/commentText';
import type { PlaygroundSource } from '../../types/aiPipeline';
import {
    formatBusinessInfoPrompt,
    unwrapBusinessProfile,
    normalizeDirectives,
    type StoredBusinessProfile,
} from '@jawab24/shared';

/** Minimal page shape needed to build playground context */
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
    /** Admin-only overrides (not available in customer-facing test) */
    conversationHistory?: { role: 'user' | 'assistant'; content: string }[];
    replyStyle?: string;
    brandVoiceNotes?: string;
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

    // 1. Fetch owner settings for comment reply mode + workspace settings for language fallback
    let commentReplyMode: 'public' | 'private' | 'dual' = 'public';
    let nudgeText: string | null = null;
    let defaultReplyLanguage: string | undefined;
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
    let timezone: string | undefined;
    if (page.workspaceId) {
        try {
            const wsSettings = await workspaceSettingsService.getSettings(page.workspaceId);
            defaultReplyLanguage = wsSettings.defaultReplyLanguage;
            timezone = wsSettings.timezone;
        } catch {
            // Non-critical — fall back to default
        }
    }

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

    // 2c. The merchant's standing ORDERS — read from the SAME place contextEnricher reads
    //     them, so the battery grades the block production sends rather than a copy of it.
    const directives = normalizeDirectives(
        (merchant as { directives?: unknown } | undefined)?.directives,
    );

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
        directives,
        // Forwarded for BOTH channels: the DM pipeline injects the origin post + the
        // merchant's Post Reply as [current_post] for comment-originated threads, so the
        // playground/eval must be able to exercise the dm+postMessage combination too.
        postMessage: postMessage,
        conversationHistory: channel === 'dm' ? conversationHistory : undefined,
        senderName: channel === 'dm' ? senderName : undefined,
        minutesSinceLastMessage: channel === 'dm' ? minutesSinceLastMessage : undefined,
        replyStyle,
        brandVoiceNotes,
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
