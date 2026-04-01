import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';

// Mock axios for API calls
vi.mock('axios');

// Mock config
vi.mock('../../src/config', () => ({
    config: {
        facebook: { graphApiVersion: 'v18.0' },
    },
}));

// Mock pages service
vi.mock('../../src/services/pages', () => ({
    pagesService: {
        getPageByInstagramId: vi.fn(),
    },
}));

// Mock instagram service
vi.mock('../../src/services/instagram', () => ({
    instagramService: {
        sendTypingIndicator: vi.fn().mockResolvedValue(undefined),
        sendDirectMessage: vi.fn().mockResolvedValue('msg-id-123'),
    },
}));

// Mock messages service (DB cache for sender name)
vi.mock('../../src/services/messages', () => ({
    messagesService: {
        getSenderNameBySenderId: vi.fn(),
        markAsReplied: vi.fn(),
    },
}));

const mockedAxios = vi.mocked(axios, true);

import { InstagramMessageAdapter } from '../../src/services/reply/adapters/instagramAdapter';
import { messagesService } from '../../src/services/messages';
import { db } from '../../src/db';

describe('InstagramMessageAdapter', () => {
    let adapter: InstagramMessageAdapter;

    const PAGE_ID = 'page-uuid-123';
    const SENDER_ID = 'ig-user-456';
    const ACCESS_TOKEN = 'test-access-token';
    const BASE = 'https://graph.facebook.com/v18.0';

    beforeEach(() => {
        vi.clearAllMocks();
        adapter = new InstagramMessageAdapter();
    });

    describe('fetchSenderName', () => {
        it('returns cached name from DB when available', async () => {
            vi.mocked(messagesService.getSenderNameBySenderId).mockResolvedValue('CachedUser');

            const name = await adapter.fetchSenderName(SENDER_ID, ACCESS_TOKEN, PAGE_ID);

            expect(name).toBe('CachedUser');
            expect(messagesService.getSenderNameBySenderId).toHaveBeenCalledWith(PAGE_ID, SENDER_ID);
            // Should NOT call the API when DB cache hits
            expect(mockedAxios.get).not.toHaveBeenCalled();
        });

        it('returns username from Instagram Graph API on DB cache miss', async () => {
            vi.mocked(messagesService.getSenderNameBySenderId).mockResolvedValue(null);
            mockedAxios.get.mockResolvedValue({
                data: { username: 'cool_user', name: 'Cool User' },
            });

            const name = await adapter.fetchSenderName(SENDER_ID, ACCESS_TOKEN, PAGE_ID);

            expect(name).toBe('cool_user');
            expect(mockedAxios.get).toHaveBeenCalledWith(`${BASE}/${SENDER_ID}`, {
                params: { fields: 'name,username', access_token: ACCESS_TOKEN },
            });
        });

        it('returns name when username is not available from API', async () => {
            vi.mocked(messagesService.getSenderNameBySenderId).mockResolvedValue(null);
            mockedAxios.get.mockResolvedValue({
                data: { name: 'Just A Name' },
            });

            const name = await adapter.fetchSenderName(SENDER_ID, ACCESS_TOKEN, PAGE_ID);

            expect(name).toBe('Just A Name');
        });

        it('returns undefined when API call fails', async () => {
            vi.mocked(messagesService.getSenderNameBySenderId).mockResolvedValue(null);
            mockedAxios.get.mockRejectedValue(new Error('Network error'));

            const name = await adapter.fetchSenderName(SENDER_ID, ACCESS_TOKEN, PAGE_ID);

            expect(name).toBeUndefined();
        });

        it('skips DB cache lookup when no pageId is provided', async () => {
            mockedAxios.get.mockResolvedValue({
                data: { username: 'no_page_user' },
            });

            const name = await adapter.fetchSenderName(SENDER_ID, ACCESS_TOKEN);

            expect(name).toBe('no_page_user');
            expect(messagesService.getSenderNameBySenderId).not.toHaveBeenCalled();
        });

        it('returns undefined when API returns empty data', async () => {
            vi.mocked(messagesService.getSenderNameBySenderId).mockResolvedValue(null);
            mockedAxios.get.mockResolvedValue({ data: {} });

            const name = await adapter.fetchSenderName(SENDER_ID, ACCESS_TOKEN, PAGE_ID);

            expect(name).toBeUndefined();
        });
    });

    describe('storeIncomingMessage', () => {
        const IG_MESSAGE_ID = 'ig-msg-abc';
        const MESSAGE_TEXT = 'Hello from Instagram';

        it('creates a new message with senderName stored', async () => {
            // No existing message
            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([]),
                }),
            } as any);

            const mockCreated = {
                id: 'new-msg-id',
                replied: false,
                needsAttention: false,
            };
            vi.mocked(db.insert).mockReturnValue({
                values: vi.fn().mockReturnValue({
                    returning: vi.fn().mockResolvedValue([mockCreated]),
                }),
            } as any);

            const result = await adapter.storeIncomingMessage(
                PAGE_ID, IG_MESSAGE_ID, SENDER_ID, MESSAGE_TEXT, 'instagram_user',
            );

            expect(result.isNew).toBe(true);
            expect(result.message.id).toBe('new-msg-id');

            // Verify insert was called with senderName
            const insertCall = vi.mocked(db.insert).mock.results[0].value;
            const valuesCall = insertCall.values;
            expect(valuesCall).toHaveBeenCalledWith(expect.objectContaining({
                senderName: 'instagram_user',
                platform: 'instagram',
                senderId: SENDER_ID,
                instagramMessageId: IG_MESSAGE_ID,
            }));
        });

        it('returns existing message without creating a new one', async () => {
            const existingRow = {
                id: 'existing-id',
                replied: true,
                needsAttention: false,
                senderName: 'already_set',
                instagramMessageId: IG_MESSAGE_ID, // already set
            };
            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([existingRow]),
                }),
            } as any);

            const result = await adapter.storeIncomingMessage(
                PAGE_ID, IG_MESSAGE_ID, SENDER_ID, MESSAGE_TEXT, 'new_name',
            );

            expect(result.isNew).toBe(false);
            expect(result.message.id).toBe('existing-id');
            expect(result.message.replied).toBe(true);
            // No updates needed — both instagramMessageId and senderName already set
            expect(db.update).not.toHaveBeenCalled();
        });

        it('backfills instagramMessageId and senderName on pre-created message', async () => {
            const existingRow = {
                id: 'existing-id',
                replied: false,
                needsAttention: false,
                senderName: null,
                instagramMessageId: null, // pre-created by nonTextHandler without this field
            };
            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([existingRow]),
                }),
            } as any);

            vi.mocked(db.update).mockReturnValue({
                set: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue(undefined),
                }),
            } as any);

            const result = await adapter.storeIncomingMessage(
                PAGE_ID, IG_MESSAGE_ID, SENDER_ID, MESSAGE_TEXT, 'late_name',
            );

            expect(result.isNew).toBe(false);
            expect(db.update).toHaveBeenCalled();
            const updateCall = vi.mocked(db.update).mock.results[0].value;
            expect(updateCall.set).toHaveBeenCalledWith({
                instagramMessageId: IG_MESSAGE_ID,
                senderName: 'late_name',
            });
        });

        it('creates message without senderName when not provided', async () => {
            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([]),
                }),
            } as any);

            const mockCreated = {
                id: 'no-name-msg',
                replied: false,
                needsAttention: false,
            };
            vi.mocked(db.insert).mockReturnValue({
                values: vi.fn().mockReturnValue({
                    returning: vi.fn().mockResolvedValue([mockCreated]),
                }),
            } as any);

            const result = await adapter.storeIncomingMessage(
                PAGE_ID, IG_MESSAGE_ID, SENDER_ID, MESSAGE_TEXT,
            );

            expect(result.isNew).toBe(true);
            expect(result.message.id).toBe('no-name-msg');

            const insertCall = vi.mocked(db.insert).mock.results[0].value;
            expect(insertCall.values).toHaveBeenCalledWith(expect.objectContaining({
                senderName: undefined,
                platform: 'instagram',
            }));
        });
    });

    describe('getInternalMessageId', () => {
        it('prefixes Instagram message ID with ig_', () => {
            expect(adapter.getInternalMessageId('abc123')).toBe('ig_abc123');
        });
    });

    describe('platform', () => {
        it('reports instagram as platform', () => {
            expect(adapter.platform).toBe('instagram');
        });
    });
});
