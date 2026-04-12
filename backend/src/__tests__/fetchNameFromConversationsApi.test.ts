import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/fbAxios', () => ({
    fbAxios: { get: vi.fn() },
    GRAPH_API_BASE: 'https://graph.facebook.com/v19.0',
}));

import { fbAxios } from '../lib/fbAxios';
import { fetchNameFromConversationsApi } from '../services/reply/adapters/shared';

const mockGet = vi.mocked(fbAxios.get);

beforeEach(() => {
    vi.clearAllMocks();
});

describe('fetchNameFromConversationsApi', () => {
    it('returns name from first matching participant', async () => {
        mockGet.mockResolvedValueOnce({
            data: {
                data: [{
                    participants: {
                        data: [
                            { id: 'other-id', name: 'Other Person' },
                            { id: 'sender-123', name: 'Ali Ahdab' },
                        ],
                    },
                }],
            },
        });

        const name = await fetchNameFromConversationsApi('page-id', 'sender-123', 'token');

        expect(name).toBe('Ali Ahdab');
    });

    it('prefers username over name when both are present', async () => {
        mockGet.mockResolvedValueOnce({
            data: {
                data: [{
                    participants: {
                        data: [{ id: 'sender-123', name: 'Full Name', username: 'handle123' }],
                    },
                }],
            },
        });

        const name = await fetchNameFromConversationsApi('page-id', 'sender-123', 'token', 'instagram');

        expect(name).toBe('handle123');
    });

    it('falls back to name when username is absent', async () => {
        mockGet.mockResolvedValueOnce({
            data: {
                data: [{
                    participants: {
                        data: [{ id: 'sender-123', name: 'Full Name' }],
                    },
                }],
            },
        });

        const name = await fetchNameFromConversationsApi('page-id', 'sender-123', 'token', 'instagram');

        expect(name).toBe('Full Name');
    });

    it('returns undefined when sender is not in participants', async () => {
        mockGet.mockResolvedValueOnce({
            data: {
                data: [{
                    participants: {
                        data: [{ id: 'different-id', name: 'Someone Else' }],
                    },
                }],
            },
        });

        const name = await fetchNameFromConversationsApi('page-id', 'sender-123', 'token');

        expect(name).toBeUndefined();
    });

    it('returns undefined when conversations list is empty', async () => {
        mockGet.mockResolvedValueOnce({ data: { data: [] } });

        const name = await fetchNameFromConversationsApi('page-id', 'sender-123', 'token');

        expect(name).toBeUndefined();
    });

    it('passes platform param for Instagram, omits it for Facebook', async () => {
        mockGet.mockResolvedValue({ data: { data: [] } });

        await fetchNameFromConversationsApi('page-id', 'sender-123', 'token', 'instagram');
        expect(mockGet).toHaveBeenCalledWith(
            expect.stringContaining('/page-id/conversations'),
            expect.objectContaining({ params: expect.objectContaining({ platform: 'instagram' }) }),
        );

        mockGet.mockClear();
        await fetchNameFromConversationsApi('page-id', 'sender-123', 'token');
        expect(mockGet).toHaveBeenCalledWith(
            expect.stringContaining('/page-id/conversations'),
            expect.objectContaining({ params: expect.not.objectContaining({ platform: expect.anything() }) }),
        );
    });

    it('propagates errors so callers can catch and handle them', async () => {
        mockGet.mockRejectedValueOnce(new Error('network error'));

        await expect(
            fetchNameFromConversationsApi('page-id', 'sender-123', 'token'),
        ).rejects.toThrow('network error');
    });
});
