import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FacebookMessageAdapter } from '../../src/services/reply/adapters/facebookAdapter';

// Mock the facebook service so we don't make real API calls
vi.mock('../../src/services/facebook', () => ({
    facebookService: {
        getSenderProfile: vi.fn(),
        sendTypingIndicator: vi.fn().mockResolvedValue(undefined),
        sendTypingOff: vi.fn().mockResolvedValue(undefined),
        sendPrivateMessage: vi.fn().mockResolvedValue(undefined),
    },
}));

// Mock messages service (used for markAsReplied / findOrCreateFromWebhook in other tests)
vi.mock('../../src/services/messages', () => ({
    messagesService: {
        findOrCreateFromWebhook: vi.fn(),
        markAsReplied: vi.fn(),
    },
}));

// Mock conversations service — the canonical source for sender names.
vi.mock('../../src/services/conversations', () => ({
    conversationsService: {
        getSenderName: vi.fn(),
        setSenderName: vi.fn().mockResolvedValue(undefined),
    },
}));

// Mock Redis (used by sender-name cache layer)
vi.mock('../../src/lib/redis', () => ({
    redis: {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue('OK'),
    },
}));

import { facebookService } from '../../src/services/facebook';
import { conversationsService } from '../../src/services/conversations';
import { redis } from '../../src/lib/redis';

describe('FacebookMessageAdapter.fetchSenderName — API path', () => {
    const adapter = new FacebookMessageAdapter();
    const SENDER_ID = 'psid_abc';
    const ACCESS_TOKEN = 'page-token';
    const PAGE_ID = 'page-uuid-123';
    const FB_PAGE_ID = 'fb-page-123';

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns name from Facebook API on cache miss', async () => {
        vi.mocked(conversationsService.getSenderName).mockResolvedValue(null);
        vi.mocked(facebookService.getSenderProfile).mockResolvedValue({ name: 'Ali Ahdab' });

        const name = await adapter.fetchSenderName(SENDER_ID, ACCESS_TOKEN, PAGE_ID, FB_PAGE_ID);

        expect(name).toBe('Ali Ahdab');
        expect(facebookService.getSenderProfile).toHaveBeenCalledWith(SENDER_ID, ACCESS_TOKEN, FB_PAGE_ID);
    });

    it('returns undefined when Facebook API returns null (both APIs failed)', async () => {
        vi.mocked(conversationsService.getSenderName).mockResolvedValue(null);
        vi.mocked(facebookService.getSenderProfile).mockResolvedValue(null);

        const name = await adapter.fetchSenderName(SENDER_ID, ACCESS_TOKEN, PAGE_ID);

        expect(name).toBeUndefined();
    });

    it('returns undefined when Facebook API throws', async () => {
        vi.mocked(conversationsService.getSenderName).mockResolvedValue(null);
        vi.mocked(facebookService.getSenderProfile).mockRejectedValue(new Error('Network error'));

        const name = await adapter.fetchSenderName(SENDER_ID, ACCESS_TOKEN, PAGE_ID);

        expect(name).toBeUndefined();
    });

    it('skips API call and returns cached name immediately', async () => {
        vi.mocked(conversationsService.getSenderName).mockResolvedValue('Cached Name');

        const name = await adapter.fetchSenderName(SENDER_ID, ACCESS_TOKEN, PAGE_ID);

        expect(name).toBe('Cached Name');
        expect(facebookService.getSenderProfile).not.toHaveBeenCalled();
    });

    it('calls API without pageId when no pageId provided', async () => {
        vi.mocked(facebookService.getSenderProfile).mockResolvedValue({ name: 'No Cache Name' });

        const name = await adapter.fetchSenderName(SENDER_ID, ACCESS_TOKEN);

        expect(name).toBe('No Cache Name');
        // getSenderNameBySenderId should NOT be called (no pageId)
        expect(conversationsService.getSenderName).not.toHaveBeenCalled();
        // getSenderProfile called without pageId (no Conversations API fallback)
        expect(facebookService.getSenderProfile).toHaveBeenCalledWith(SENDER_ID, ACCESS_TOKEN, undefined);
    });

    it('returns name from Redis cache on DB miss (skips Facebook API)', async () => {
        vi.mocked(conversationsService.getSenderName).mockResolvedValue(null);
        vi.mocked(redis.get).mockResolvedValue('Redis Cached Name');

        const name = await adapter.fetchSenderName(SENDER_ID, ACCESS_TOKEN, PAGE_ID);

        expect(name).toBe('Redis Cached Name');
        expect(redis.get).toHaveBeenCalledWith(`sender_name:${SENDER_ID}`);
        expect(facebookService.getSenderProfile).not.toHaveBeenCalled();
    });

    it('writes name to Redis after Facebook API fetch', async () => {
        vi.mocked(conversationsService.getSenderName).mockResolvedValue(null);
        vi.mocked(redis.get).mockResolvedValue(null);
        vi.mocked(facebookService.getSenderProfile).mockResolvedValue({ name: 'From API' });

        const name = await adapter.fetchSenderName(SENDER_ID, ACCESS_TOKEN, PAGE_ID);

        expect(name).toBe('From API');
        expect(redis.set).toHaveBeenCalledWith(
            `sender_name:${SENDER_ID}`, 'From API', 'EX', 86400,
        );
    });

    it('falls through to API when Redis throws', async () => {
        vi.mocked(conversationsService.getSenderName).mockResolvedValue(null);
        vi.mocked(redis.get).mockRejectedValue(new Error('Redis down'));
        vi.mocked(facebookService.getSenderProfile).mockResolvedValue({ name: 'Fallback API' });

        const name = await adapter.fetchSenderName(SENDER_ID, ACCESS_TOKEN, PAGE_ID);

        expect(name).toBe('Fallback API');
        expect(facebookService.getSenderProfile).toHaveBeenCalled();
    });

    it('passes platformPageId (not internal pageId) to getSenderProfile for Conversations API', async () => {
        vi.mocked(conversationsService.getSenderName).mockResolvedValue(null);
        vi.mocked(facebookService.getSenderProfile).mockResolvedValue({ name: 'Via Conversations API' });

        const name = await adapter.fetchSenderName(SENDER_ID, ACCESS_TOKEN, PAGE_ID, FB_PAGE_ID);

        expect(name).toBe('Via Conversations API');
        // CRITICAL: getSenderProfile must receive FB_PAGE_ID (Facebook page ID),
        // not PAGE_ID (internal DB UUID), so the Conversations API fallback works
        expect(facebookService.getSenderProfile).toHaveBeenCalledWith(SENDER_ID, ACCESS_TOKEN, FB_PAGE_ID);
    });

    it('uses internal pageId for DB cache but platformPageId for API', async () => {
        vi.mocked(conversationsService.getSenderName).mockResolvedValue(null);
        vi.mocked(facebookService.getSenderProfile).mockResolvedValue({ name: 'API Name' });

        await adapter.fetchSenderName(SENDER_ID, ACCESS_TOKEN, PAGE_ID, FB_PAGE_ID);

        // DB lookup uses internal pageId
        expect(conversationsService.getSenderName).toHaveBeenCalledWith(PAGE_ID, SENDER_ID);
        // Facebook API uses platformPageId
        expect(facebookService.getSenderProfile).toHaveBeenCalledWith(SENDER_ID, ACCESS_TOKEN, FB_PAGE_ID);
    });
});

describe('FacebookMessageAdapter — typing indicator', () => {
    const adapter = new FacebookMessageAdapter();
    const mockPage = {
        id: 'page-uuid',
        userId: 'user-uuid',
        workspaceId: 'ws-uuid',
        name: 'Test Page',
        accessToken: 'page-token',
        knowledgeBase: null,
        kbActiveVersion: null,
        autoReplyEnabled: true,
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('sendTypingIndicator delegates to facebookService', async () => {
        await adapter.sendTypingIndicator(mockPage, 'recipient-1');

        expect(facebookService.sendTypingIndicator).toHaveBeenCalledWith('page-token', 'recipient-1');
    });

    it('sendTypingOff delegates to facebookService', async () => {
        await adapter.sendTypingOff(mockPage, 'recipient-1');

        expect(facebookService.sendTypingOff).toHaveBeenCalledWith('page-token', 'recipient-1');
    });

    it('sendReply sends message without calling typing (typing is handled by processor)', async () => {
        await adapter.sendReply(mockPage, 'recipient-1', 'Hello!');

        expect(facebookService.sendPrivateMessage).toHaveBeenCalledWith('page-token', 'recipient-1', 'Hello!');
        expect(facebookService.sendTypingIndicator).not.toHaveBeenCalled();
    });

    it('sendAwayMessage sends message without calling typing', async () => {
        await adapter.sendAwayMessage(mockPage, 'recipient-1', 'We are away');

        expect(facebookService.sendPrivateMessage).toHaveBeenCalledWith('page-token', 'recipient-1', 'We are away');
        expect(facebookService.sendTypingIndicator).not.toHaveBeenCalled();
    });
});

describe('FacebookMessageAdapter.renderReply — forwards knownPhones to the isolator', () => {
    const adapter = new FacebookMessageAdapter();

    it('isolates a merchant number passed as knownPhones (a spaced number would paint backwards without it)', () => {
        const LRI = '⁦';
        const PDI = '⁩';
        const out = adapter.renderReply('تواصل معنا على +46 70 022 47 20 مباشرة', ['+46 70 022 47 20']);
        expect(out).toBe(`تواصل معنا على ${LRI}+46 70 022 47 20${PDI} مباشرة`);
    });

    it('leaves the number untouched when no knownPhones are forwarded', () => {
        const out = adapter.renderReply('تواصل معنا على +46 70 022 47 20 مباشرة');
        // Only the "+46" fragment is isolated by isolateNumericTokens — the whole-number
        // repair is exactly what the knownPhones argument adds.
        expect(out).toBe('تواصل معنا على ⁦+46⁩ 70 022 47 20 مباشرة');
    });
});
