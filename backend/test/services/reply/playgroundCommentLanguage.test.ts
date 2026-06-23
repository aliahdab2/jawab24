/**
 * Production regression: the smart-reply TEST TOOL (and the admin playground / eval,
 * which share `generateForPlayground`) replied in ENGLISH to a bare Latin token ("Icdl")
 * on an Arabic post — even after fix #344 made the real comment path mirror the post.
 *
 * Mechanism: `buildPlaygroundContext` flattens dual/private comment modes to the DM
 * channel (the detailed reply is sent as a DM). `generateForPlayground` then gated its
 * comment-language resolution on the *effective* channel, so for a dual/private merchant
 * a comment test arrived as `channel='dm'` and fell back to `detectLanguageCode(question)`
 * = 'en' instead of `resolveCommentLanguage(...)` = 'ar'. The screenshot merchant runs in
 * dual mode (public nudge + private DM), so the tool showed English while production —
 * `generateForComment`, which always runs `resolveCommentLanguage` — correctly replied
 * in Arabic.
 *
 * The fix threads the user's *requested* channel through `PlaygroundInput.requestedChannel`
 * so the comment-language step follows it, independent of the dm flattening. This test uses
 * the REAL language utils (the sibling generator.test.ts mocks them globally, which would
 * hide the bug) and only mocks the AI dispatch boundary.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock ONLY the AI dispatch boundary + side-effecting services. Language utils stay REAL.
vi.mock('../../../src/services/ai', () => ({
    aiService: { generateReply: vi.fn() },
}));
vi.mock('../../../src/services/ecommerceToolLoop', () => ({
    generateReplyWithTools: vi.fn(),
}));
vi.mock('../../../src/services/messages', () => ({
    messagesService: {
        getConversationHistory: vi.fn().mockResolvedValue([]),
        getCustomerSummary: vi.fn().mockResolvedValue(undefined),
    },
}));
vi.mock('../../../src/services/posts', () => ({
    postsService: { findOrCreateFromWebhook: vi.fn() },
}));
vi.mock('../../../src/services/subscriptions', () => ({
    subscriptionsService: {
        canUseAiReplies: vi.fn().mockResolvedValue({ allowed: true, limit: 1500, used: 0, remaining: 1500 }),
        incrementAiReplies: vi.fn().mockResolvedValue(undefined),
        logQuotaEvent: vi.fn().mockResolvedValue(undefined),
    },
}));
vi.mock('../../../src/services/workspaceSettings', () => ({
    workspaceSettingsService: {
        getLimitFallbackMessage: vi.fn().mockResolvedValue(null),
        getSettings: vi.fn().mockResolvedValue({ limitFallbackEnabled: false }),
    },
}));
vi.mock('../../../src/services/kb/gap-detector', () => ({
    gapDetectorService: {
        setLogger: vi.fn(),
        recordGap: vi.fn().mockResolvedValue(undefined),
    },
}));

import { ReplyGenerator } from '../../../src/services/reply/generator';
import { aiService } from '../../../src/services/ai';

// Faithful copy of the reported Arabic post.
const ARABIC_POST =
    '#عرووووض 🔥💢\n' +
    'على دورات #الكومبيوتر\n' +
    '👈مع الأستاذ المتميز أنس الأشقر\n' +
    '🔴دورة icdl\n' +
    '8 جلسات لمدة شهر بكلفة 35 الف بالعملة القديمة';

const AI_RESPONSE = {
    reply: 'mocked reply', language: 'ar', cached: false,
    intent: 'QUESTION', confidence: 'high', flags: [],
};

function languageOfLastAiCall(): string | undefined {
    const calls = vi.mocked(aiService.generateReply).mock.calls;
    return calls[calls.length - 1]?.[0]?.language;
}

describe('generateForPlayground — comment language follows the requested channel', () => {
    let generator: ReplyGenerator;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(aiService.generateReply).mockResolvedValue(AI_RESPONSE);
        generator = new ReplyGenerator();
    });

    const base = {
        pageId: 'page-1',
        userId: 'user-1',
        workspaceId: 'ws-1',
        kbActiveVersion: null, // no RAG in the test → resolveKnowledge returns early
        pageName: 'Damascus Institute',
        // knowledgeBase intentionally omitted: under RAG the generator drops it
        // (effectiveKB=undefined), which is exactly the state that exposed the bug.
        postMessage: ARABIC_POST,
    } as const;

    it('dual/private comment test (flattened to channel="dm") still resolves "Icdl" to Arabic from the post', async () => {
        await generator.generateForPlayground({
            ...base,
            question: 'Icdl',
            channel: 'dm',          // effective channel after dual/private flattening
            requestedChannel: 'comment',
        });
        expect(languageOfLastAiCall()).toBe('ar');
    });

    it('public comment test (channel="comment") resolves "Icdl" to Arabic — unchanged behavior', async () => {
        await generator.generateForPlayground({
            ...base,
            question: 'Icdl',
            channel: 'comment',
            requestedChannel: 'comment',
        });
        expect(languageOfLastAiCall()).toBe('ar');
    });

    it('a genuine DM test for "Icdl" keeps English (no requestedChannel override)', async () => {
        await generator.generateForPlayground({
            ...base,
            question: 'Icdl',
            channel: 'dm',
            requestedChannel: 'dm',
            postMessage: undefined, // DMs carry no post context
        });
        expect(languageOfLastAiCall()).toBe('en');
    });

    it('back-compat: missing requestedChannel falls back to the effective channel', async () => {
        // A legacy caller that only sets channel='dm' behaves as a DM (old behavior),
        // so this must NOT accidentally start mirroring the post.
        await generator.generateForPlayground({
            ...base,
            question: 'Icdl',
            channel: 'dm',
            postMessage: undefined,
        });
        expect(languageOfLastAiCall()).toBe('en');
    });
});
