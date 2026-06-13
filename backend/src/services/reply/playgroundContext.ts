import { settingsService } from '../settings';
import { workspaceSettingsService } from '../workspaceSettings';
import { getEnrichedKnowledgeBase, getStoreContextForAI } from '../ecommerce';
import { pickNudgeVariation } from './nudge';
import { detectLanguageCode } from '../../utils/language';
import type { PlaygroundInput } from './generator';
import type { FacebookMessageTag } from '../../utils/commentText';
import type { PlaygroundSource } from '../../types/aiPipeline';
import {
    formatBusinessInfoPrompt,
    unwrapBusinessProfile,
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
    const { page, question, channel, postMessage, messageTags, ourFacebookPageId, conversationHistory, replyStyle, brandVoiceNotes, customerContext, model, source } = opts;

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
    if (page.workspaceId) {
        try {
            const wsSettings = await workspaceSettingsService.getSettings(page.workspaceId);
            defaultReplyLanguage = wsSettings.defaultReplyLanguage;
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
    }

    // 2b. Stage 2.6 structured BUSINESS_INFO block — built from merchant half only.
    const { merchant } = unwrapBusinessProfile(page.businessProfile as StoredBusinessProfile);
    const businessInfoBlock = formatBusinessInfoPrompt(merchant ?? null);

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
        knowledgeBase: pageKB,
        kbActiveVersion: page.kbActiveVersion,
        pageName: page.name ?? undefined,
        productCatalog,
        storePolicies,
        postMessage: channel === 'comment' ? postMessage : undefined,
        conversationHistory: channel === 'dm' ? conversationHistory : undefined,
        replyStyle,
        brandVoiceNotes,
        businessInfoBlock,
        customerContext,
        model,
        defaultReplyLanguage,
        messageTags: channel === 'comment' ? messageTags : undefined,
        ourFacebookPageId: channel === 'comment' ? ourFacebookPageId : undefined,
        ecommerceStoreId: page.ecommerceStoreId ?? undefined,
        pipeline: source === 'eval' ? 'eval' : 'playground',
    };

    return { playgroundInput, commentReplyMode, nudgeText };
}
