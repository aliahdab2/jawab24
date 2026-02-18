import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FacebookMessageAdapter } from '../../src/services/reply/adapters/facebookAdapter';

// Mock the facebook service so we don't make real API calls
vi.mock('../../src/services/facebook', () => ({
    facebookService: {
        getSenderProfile: vi.fn(),
    },
}));

// Mock messages service DB cache
vi.mock('../../src/services/messages', () => ({
    messagesService: {
        getSenderNameBySenderId: vi.fn(),
        findOrCreateFromWebhook: vi.fn(),
        markAsReplied: vi.fn(),
    },
}));

import { facebookService } from '../../src/services/facebook';
import { messagesService } from '../../src/services/messages';

describe('FacebookMessageAdapter.fetchSenderName — API path', () => {
    const adapter = new FacebookMessageAdapter();
    const SENDER_ID = 'psid_abc';
    const ACCESS_TOKEN = 'page-token';
    const PAGE_ID = 'page-uuid-123';

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns name from Facebook API on cache miss', async () => {
        vi.mocked(messagesService.getSenderNameBySenderId).mockResolvedValue(null);
        vi.mocked(facebookService.getSenderProfile).mockResolvedValue({ name: 'Ali Ahdab' });

        const name = await adapter.fetchSenderName(SENDER_ID, ACCESS_TOKEN, PAGE_ID);

        expect(name).toBe('Ali Ahdab');
        expect(facebookService.getSenderProfile).toHaveBeenCalledWith(SENDER_ID, ACCESS_TOKEN, PAGE_ID);
    });

    it('returns undefined when Facebook API returns null (both APIs failed)', async () => {
        vi.mocked(messagesService.getSenderNameBySenderId).mockResolvedValue(null);
        vi.mocked(facebookService.getSenderProfile).mockResolvedValue(null);

        const name = await adapter.fetchSenderName(SENDER_ID, ACCESS_TOKEN, PAGE_ID);

        expect(name).toBeUndefined();
    });

    it('returns undefined when Facebook API throws', async () => {
        vi.mocked(messagesService.getSenderNameBySenderId).mockResolvedValue(null);
        vi.mocked(facebookService.getSenderProfile).mockRejectedValue(new Error('Network error'));

        const name = await adapter.fetchSenderName(SENDER_ID, ACCESS_TOKEN, PAGE_ID);

        expect(name).toBeUndefined();
    });

    it('skips API call and returns cached name immediately', async () => {
        vi.mocked(messagesService.getSenderNameBySenderId).mockResolvedValue('Cached Name');

        const name = await adapter.fetchSenderName(SENDER_ID, ACCESS_TOKEN, PAGE_ID);

        expect(name).toBe('Cached Name');
        expect(facebookService.getSenderProfile).not.toHaveBeenCalled();
    });

    it('calls API without pageId when no pageId provided', async () => {
        vi.mocked(facebookService.getSenderProfile).mockResolvedValue({ name: 'No Cache Name' });

        const name = await adapter.fetchSenderName(SENDER_ID, ACCESS_TOKEN);

        expect(name).toBe('No Cache Name');
        // getSenderNameBySenderId should NOT be called (no pageId)
        expect(messagesService.getSenderNameBySenderId).not.toHaveBeenCalled();
        // getSenderProfile called without pageId (no Conversations API fallback)
        expect(facebookService.getSenderProfile).toHaveBeenCalledWith(SENDER_ID, ACCESS_TOKEN, undefined);
    });
});
