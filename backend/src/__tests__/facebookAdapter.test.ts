import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/pages', () => ({
    pagesService: {
        getPageByFacebookId: vi.fn(),
    },
}));

vi.mock('../services/conversations', () => ({
    conversationsService: {
        getSenderName: vi.fn(),
        setSenderName: vi.fn().mockResolvedValue(undefined),
    },
}));

vi.mock('../services/facebook', () => ({
    facebookService: {
        getSenderProfile: vi.fn(),
    },
}));

vi.mock('../lib/redis', () => ({
    redis: {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue('OK'),
    },
}));

import { facebookMessageAdapter } from '../services/reply/adapters/facebookAdapter';
import { pagesService } from '../services/pages';
import { conversationsService } from '../services/conversations';
import { facebookService } from '../services/facebook';

const mockDbPage = {
    id: 'internal-uuid',
    userId: 'user-1',
    workspaceId: 'ws-1',
    name: 'Test Page',
    accessToken: 'page-token',
    facebookPageId: 'fb-page-123',
    knowledgeBase: null,
    kbActiveVersion: null,
    ecommerceStoreId: null,
    businessProfile: null,
    autoReplyEnabled: true,
};

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(conversationsService.getSenderName).mockResolvedValue(null);
});

describe('facebookMessageAdapter.getPage', () => {
    it('sets platformAccountId to facebookPageId so the Conversations API fallback is available', async () => {
        vi.mocked(pagesService.getPageByFacebookId).mockResolvedValue(mockDbPage as never);

        const page = await facebookMessageAdapter.getPage('fb-page-123');

        expect(page).not.toBeNull();
        expect(page?.platformAccountId).toBe('fb-page-123');
    });

    it('returns null when page is not found', async () => {
        vi.mocked(pagesService.getPageByFacebookId).mockResolvedValue(null as never);

        const page = await facebookMessageAdapter.getPage('unknown-page');

        expect(page).toBeNull();
    });
});

describe('facebookMessageAdapter.fetchSenderName — Conversations API fallback', () => {
    it('returns name from Conversations API when direct profile lookup fails', async () => {
        vi.mocked(facebookService.getSenderProfile).mockResolvedValue({ name: 'Ali Ahdab' });

        const name = await facebookMessageAdapter.fetchSenderName(
            'sender-psid',
            'page-token',
            'internal-uuid',
            'fb-page-123',
        );

        expect(name).toBe('Ali Ahdab');
        expect(facebookService.getSenderProfile).toHaveBeenCalledWith(
            'sender-psid',
            'page-token',
            'fb-page-123',
        );
    });

    it('passes platformPageId to getSenderProfile so Conversations API fallback can run', async () => {
        vi.mocked(facebookService.getSenderProfile).mockResolvedValue(null);

        await facebookMessageAdapter.fetchSenderName(
            'sender-psid',
            'page-token',
            'internal-uuid',
            'fb-page-123',
        );

        // platformPageId must reach getSenderProfile — without it the Conversations API fallback is skipped
        expect(facebookService.getSenderProfile).toHaveBeenCalledWith(
            'sender-psid',
            'page-token',
            'fb-page-123',
        );
    });

    it('returns undefined when both profile lookup and Conversations API fail', async () => {
        vi.mocked(facebookService.getSenderProfile).mockResolvedValue(null);

        const name = await facebookMessageAdapter.fetchSenderName(
            'sender-psid',
            'page-token',
            'internal-uuid',
            'fb-page-123',
        );

        expect(name).toBeUndefined();
    });

    it('returns cached DB name without calling getSenderProfile', async () => {
        vi.mocked(conversationsService.getSenderName).mockResolvedValue('Cached Name');

        const name = await facebookMessageAdapter.fetchSenderName(
            'sender-psid',
            'page-token',
            'internal-uuid',
            'fb-page-123',
        );

        expect(name).toBe('Cached Name');
        expect(facebookService.getSenderProfile).not.toHaveBeenCalled();
    });
});
