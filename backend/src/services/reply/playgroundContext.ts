import { settingsService } from '../settings';
import { getEnrichedKnowledgeBase, getStoreContextForAI } from '../ecommerce';
import { pickNudgeVariation } from './nudge';
import { detectLanguageCode } from '../../utils/language';
import type { PlaygroundInput } from './generator';

/** Minimal page shape needed to build playground context */
export interface PlaygroundPageData {
    id: string;
    name?: string | null;
    userId?: string | null;
    workspaceId: string | null;
    knowledgeBase?: string | null;
    kbActiveVersion?: number | null;
    ecommerceStoreId?: string | null;
}

interface PlaygroundContextOptions {
    page: PlaygroundPageData;
    question: string;
    channel: 'comment' | 'dm';
    postMessage?: string;
    /** Admin-only overrides (not available in customer-facing test) */
    conversationHistory?: { role: 'user' | 'assistant'; content: string }[];
    replyStyle?: string;
    brandVoiceNotes?: string;
    customerContext?: string;
    model?: string;
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
    const { page, question, channel, postMessage, conversationHistory, replyStyle, brandVoiceNotes, customerContext, model } = opts;

    // 1. Fetch owner settings for comment reply mode
    let commentReplyMode: 'public' | 'private' | 'dual' = 'public';
    let nudgeText: string | null = null;
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
        customerContext,
        model,
    };

    return { playgroundInput, commentReplyMode, nudgeText };
}
