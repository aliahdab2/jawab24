import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';

vi.mock('axios');
vi.mock('../../src/config', () => ({
    config: {
        facebook: { graphApiVersion: 'v18.0' },
    },
}));

const mockedAxios = vi.mocked(axios, true);

import { InstagramService } from '../../src/services/instagram';

describe('InstagramService', () => {
    let service: InstagramService;
    const pageAccessToken = 'test-token';
    const BASE = 'https://graph.facebook.com/v18.0';

    beforeEach(() => {
        vi.clearAllMocks();
        service = new InstagramService();
    });

    describe('setLogger', () => {
        it('should accept a logger without error', () => {
            const logger = { debug: vi.fn(), info: vi.fn(), error: vi.fn(), warn: vi.fn() };
            expect(() => service.setLogger(logger as any)).not.toThrow();
        });
    });

    describe('getLinkedInstagramAccount', () => {
        it('should return the Instagram business account when linked', async () => {
            const igAccount = { id: 'ig-123', username: 'testuser', name: 'Test' };
            mockedAxios.get.mockResolvedValue({ data: { instagram_business_account: igAccount } });

            const result = await service.getLinkedInstagramAccount('page-1', pageAccessToken);

            expect(result).toEqual(igAccount);
            expect(mockedAxios.get).toHaveBeenCalledWith(`${BASE}/page-1`, {
                params: {
                    fields: 'instagram_business_account{id,username,name,profile_picture_url,followers_count,media_count}',
                    access_token: pageAccessToken,
                },
            });
        });

        it('should return null when no Instagram account is linked', async () => {
            mockedAxios.get.mockResolvedValue({ data: {} });

            const result = await service.getLinkedInstagramAccount('page-1', pageAccessToken);
            expect(result).toBeNull();
        });

        it('should throw when access token expired (error code 190)', async () => {
            const error = new Error('Token expired');
            (error as any).response = { data: { error: { code: 190, message: 'Token expired' } } };
            (error as any).isAxiosError = true;
            mockedAxios.get.mockRejectedValue(error);
            mockedAxios.isAxiosError.mockReturnValue(true);

            await expect(service.getLinkedInstagramAccount('page-1', pageAccessToken))
                .rejects.toThrow('Access token expired');
        });

        it('should return null for non-190 Axios errors', async () => {
            const error = new Error('Network error');
            (error as any).response = { data: { error: { code: 100, message: 'Other error' } } };
            (error as any).isAxiosError = true;
            mockedAxios.get.mockRejectedValue(error);
            mockedAxios.isAxiosError.mockReturnValue(true);

            const result = await service.getLinkedInstagramAccount('page-1', pageAccessToken);
            expect(result).toBeNull();
        });

        it('should rethrow non-Axios errors', async () => {
            mockedAxios.get.mockRejectedValue(new TypeError('unexpected'));
            mockedAxios.isAxiosError.mockReturnValue(false);

            await expect(service.getLinkedInstagramAccount('page-1', pageAccessToken))
                .rejects.toThrow('unexpected');
        });
    });

    describe('getMedia', () => {
        it('should return media items', async () => {
            const media = [{ id: 'm1' }, { id: 'm2' }];
            mockedAxios.get.mockResolvedValue({ data: { data: media } });

            const result = await service.getMedia('ig-123', pageAccessToken, 10);

            expect(result).toEqual(media);
            expect(mockedAxios.get).toHaveBeenCalledWith(`${BASE}/ig-123/media`, {
                params: {
                    fields: 'id,media_type,caption,permalink,thumbnail_url,timestamp,comments_count',
                    limit: 10,
                    access_token: pageAccessToken,
                },
            });
        });

        it('should return empty array when data is undefined', async () => {
            mockedAxios.get.mockResolvedValue({ data: {} });
            const result = await service.getMedia('ig-123', pageAccessToken);
            expect(result).toEqual([]);
        });

        it('should throw formatted error on Axios failure', async () => {
            const error = new Error('fail');
            (error as any).response = { data: { error: { message: 'Rate limited' } } };
            mockedAxios.get.mockRejectedValue(error);
            mockedAxios.isAxiosError.mockReturnValue(true);

            await expect(service.getMedia('ig-123', pageAccessToken))
                .rejects.toThrow('Instagram API error: Rate limited');
        });
    });

    describe('getComments', () => {
        it('should return comments', async () => {
            const comments = [{ id: 'c1', text: 'hello' }];
            mockedAxios.get.mockResolvedValue({ data: { data: comments } });

            const result = await service.getComments('media-1', pageAccessToken);

            expect(result).toEqual(comments);
            expect(mockedAxios.get).toHaveBeenCalledWith(`${BASE}/media-1/comments`, {
                params: {
                    fields: 'id,text,timestamp,from{id,username},replies{id,text,timestamp,from{id,username}}',
                    access_token: pageAccessToken,
                },
            });
        });

        it('should return empty array when no comments', async () => {
            mockedAxios.get.mockResolvedValue({ data: {} });
            const result = await service.getComments('media-1', pageAccessToken);
            expect(result).toEqual([]);
        });
    });

    describe('replyToComment', () => {
        it('should post a reply and return the reply ID', async () => {
            mockedAxios.post.mockResolvedValue({ data: { id: 'reply-1' } });

            const result = await service.replyToComment('comment-1', 'Thanks!', pageAccessToken);

            expect(result).toBe('reply-1');
            expect(mockedAxios.post).toHaveBeenCalledWith(
                `${BASE}/comment-1/replies`,
                { message: 'Thanks!' },
                { params: { access_token: pageAccessToken } },
            );
        });

        it('should throw on Axios error', async () => {
            const error = new Error('fail');
            (error as any).response = { data: { error: { message: 'Cannot reply' } } };
            mockedAxios.post.mockRejectedValue(error);
            mockedAxios.isAxiosError.mockReturnValue(true);

            await expect(service.replyToComment('c1', 'text', pageAccessToken))
                .rejects.toThrow('Instagram API error: Cannot reply');
        });
    });

    describe('hideComment', () => {
        it('should hide a comment', async () => {
            mockedAxios.post.mockResolvedValue({ data: { success: true } });

            await service.hideComment('comment-1', pageAccessToken);

            expect(mockedAxios.post).toHaveBeenCalledWith(
                `${BASE}/comment-1`,
                { hide: true },
                { params: { access_token: pageAccessToken } },
            );
        });

        it('should throw on Axios error', async () => {
            const error = new Error('fail');
            (error as any).response = { data: { error: { message: 'Not found' } } };
            mockedAxios.post.mockRejectedValue(error);
            mockedAxios.isAxiosError.mockReturnValue(true);

            await expect(service.hideComment('c1', pageAccessToken))
                .rejects.toThrow('Instagram API error: Not found');
        });
    });

    describe('deleteComment', () => {
        it('should delete a comment', async () => {
            mockedAxios.delete.mockResolvedValue({ data: { success: true } });

            await service.deleteComment('comment-1', pageAccessToken);

            expect(mockedAxios.delete).toHaveBeenCalledWith(`${BASE}/comment-1`, {
                params: { access_token: pageAccessToken },
            });
        });

        it('should rethrow non-Axios errors', async () => {
            mockedAxios.delete.mockRejectedValue(new TypeError('boom'));
            mockedAxios.isAxiosError.mockReturnValue(false);

            await expect(service.deleteComment('c1', pageAccessToken))
                .rejects.toThrow('boom');
        });
    });

    describe('sendDirectMessage', () => {
        it('should send a DM and return message ID', async () => {
            mockedAxios.post.mockResolvedValue({ data: { message_id: 'msg-1' } });

            const result = await service.sendDirectMessage('ig-123', 'user-1', 'Hello', pageAccessToken);

            expect(result).toBe('msg-1');
            expect(mockedAxios.post).toHaveBeenCalledWith(
                `${BASE}/me/messages`,
                { recipient: { id: 'user-1' }, message: { text: 'Hello' }, messaging_type: 'RESPONSE' },
                { params: { access_token: pageAccessToken } },
            );
        });

        it('should throw on API error', async () => {
            const error = new Error('fail');
            (error as any).response = { data: { error: { message: 'Blocked' } } };
            mockedAxios.post.mockRejectedValue(error);
            mockedAxios.isAxiosError.mockReturnValue(true);

            await expect(service.sendDirectMessage('ig-123', 'u1', 'Hi', pageAccessToken))
                .rejects.toThrow('Instagram API error: Blocked');
        });
    });

    describe('getConversations', () => {
        it('should return conversations', async () => {
            const convos = [{ id: 'conv-1' }];
            mockedAxios.get.mockResolvedValue({ data: { data: convos } });

            const result = await service.getConversations('ig-123', pageAccessToken);

            expect(result).toEqual(convos);
            expect(mockedAxios.get).toHaveBeenCalledWith(`${BASE}/ig-123/conversations`, {
                params: {
                    platform: 'instagram',
                    fields: 'participants,messages{id,message,from,to,created_time}',
                    access_token: pageAccessToken,
                },
            });
        });

        it('should return empty array when no conversations', async () => {
            mockedAxios.get.mockResolvedValue({ data: {} });
            const result = await service.getConversations('ig-123', pageAccessToken);
            expect(result).toEqual([]);
        });

        it('should throw on Axios error', async () => {
            const error = new Error('fail');
            (error as any).response = { data: { error: { message: 'Unauthorized' } } };
            mockedAxios.get.mockRejectedValue(error);
            mockedAxios.isAxiosError.mockReturnValue(true);

            await expect(service.getConversations('ig-123', pageAccessToken))
                .rejects.toThrow('Instagram API error: Unauthorized');
        });
    });
});
