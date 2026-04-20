import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/db', () => ({
    db: {
        insert: vi.fn(),
        update: vi.fn(),
        query: {
            conversations: { findFirst: vi.fn() },
        },
    },
}));

import { conversationsService } from '../../src/services/conversations';
import { db } from '../../src/db';

function mockConvRow(overrides: Record<string, any> = {}) {
    return {
        id: 'conv-1',
        pageId: 'page-1',
        senderId: 'sender-1',
        platform: 'facebook',
        senderName: 'Alice',
        originContentId: null,
        createdAt: new Date('2026-04-01'),
        updatedAt: new Date('2026-04-01'),
        ...overrides,
    };
}

describe('ConversationsService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('findOrCreate', () => {
        function stubInsertReturning(row: any, capturedValues: { v?: any; set?: any }): void {
            vi.mocked(db.insert).mockReturnValue({
                values: (v: any) => {
                    capturedValues.v = v;
                    return {
                        onConflictDoUpdate: (cfg: any) => {
                            capturedValues.set = cfg.set;
                            return { returning: vi.fn().mockResolvedValue([row]) };
                        },
                    };
                },
            } as any);
        }

        it('returns the conversation row (upsert via ON CONFLICT)', async () => {
            const captured: { v?: any; set?: any } = {};
            stubInsertReturning(mockConvRow(), captured);

            const result = await conversationsService.findOrCreate('page-1', 'sender-1', 'facebook', 'Alice');

            expect(result).toMatchObject({
                id: 'conv-1',
                pageId: 'page-1',
                senderId: 'sender-1',
                platform: 'facebook',
                senderName: 'Alice',
            });
        });

        it('writes the supplied senderName when non-empty', async () => {
            const captured: { v?: any; set?: any } = {};
            stubInsertReturning(mockConvRow(), captured);

            await conversationsService.findOrCreate('page-1', 'sender-1', 'facebook', 'Alice');

            expect(captured.v).toMatchObject({
                pageId: 'page-1',
                senderId: 'sender-1',
                platform: 'facebook',
                senderName: 'Alice',
            });
        });

        it('writes null senderName when an empty string is supplied', async () => {
            const captured: { v?: any; set?: any } = {};
            stubInsertReturning(mockConvRow({ senderName: null }), captured);

            await conversationsService.findOrCreate('page-1', 'sender-1', 'facebook', '');

            expect(captured.v.senderName).toBeNull();
        });

        it('writes null senderName when undefined is supplied', async () => {
            const captured: { v?: any; set?: any } = {};
            stubInsertReturning(mockConvRow({ senderName: null }), captured);

            await conversationsService.findOrCreate('page-1', 'sender-1', 'instagram');

            expect(captured.v.senderName).toBeNull();
        });

        it('accepts all three platforms', async () => {
            const captured: { v?: any; set?: any } = {};
            for (const platform of ['facebook', 'instagram', 'whatsapp'] as const) {
                stubInsertReturning(mockConvRow({ platform }), captured);
                const result = await conversationsService.findOrCreate('p', 's', platform, 'n');
                expect(result.platform).toBe(platform);
            }
        });

        describe('originContentId (comment→DM origin linking)', () => {
            it('writes the supplied originContentId on insert', async () => {
                const captured: { v?: any; set?: any } = {};
                stubInsertReturning(mockConvRow({ originContentId: 'post-42' }), captured);

                await conversationsService.findOrCreate(
                    'page-1', 'sender-1', 'facebook', 'Alice', 'post-42',
                );

                expect(captured.v.originContentId).toBe('post-42');
            });

            it('writes null originContentId when undefined is supplied', async () => {
                const captured: { v?: any; set?: any } = {};
                stubInsertReturning(mockConvRow({ originContentId: null }), captured);

                await conversationsService.findOrCreate('page-1', 'sender-1', 'facebook', 'Alice');

                expect(captured.v.originContentId).toBeNull();
            });

            it('does NOT include originContentId in ON CONFLICT SET when not supplied (preserve existing)', async () => {
                const captured: { v?: any; set?: any } = {};
                stubInsertReturning(mockConvRow(), captured);

                await conversationsService.findOrCreate('page-1', 'sender-1', 'facebook', 'Alice');

                expect(captured.set).not.toHaveProperty('originContentId');
            });

            it('includes originContentId in ON CONFLICT SET (first-write-wins via COALESCE) when supplied', async () => {
                const captured: { v?: any; set?: any } = {};
                stubInsertReturning(mockConvRow({ originContentId: 'post-42' }), captured);

                await conversationsService.findOrCreate(
                    'page-1', 'sender-1', 'facebook', 'Alice', 'post-42',
                );

                // On conflict the COALESCE expression keeps the existing value if already set,
                // and only fills it in when the stored row has NULL — never overwrites.
                expect(captured.set).toHaveProperty('originContentId');
            });

            it('returns originContentId from the DB row in the mapped Conversation', async () => {
                const captured: { v?: any; set?: any } = {};
                stubInsertReturning(mockConvRow({ originContentId: 'post-42' }), captured);

                const result = await conversationsService.findOrCreate(
                    'page-1', 'sender-1', 'facebook', 'Alice', 'post-42',
                );

                expect(result.originContentId).toBe('post-42');
            });
        });
    });

    describe('setSenderName', () => {
        it('updates senderName when non-empty', async () => {
            const whereSpy = vi.fn().mockResolvedValue(undefined);
            let capturedSet: any = null;
            vi.mocked(db.update).mockReturnValue({
                set: (v: any) => {
                    capturedSet = v;
                    return { where: whereSpy };
                },
            } as any);

            await conversationsService.setSenderName('page-1', 'sender-1', 'Bob');

            expect(capturedSet.senderName).toBe('Bob');
            expect(whereSpy).toHaveBeenCalled();
        });

        it('skips the DB call when given an empty string (no-op)', async () => {
            await conversationsService.setSenderName('page-1', 'sender-1', '');
            expect(db.update).not.toHaveBeenCalled();
        });
    });

    describe('getSenderName', () => {
        it('returns the senderName when the conversation exists', async () => {
            vi.mocked(db.query.conversations.findFirst).mockResolvedValue(
                { senderName: 'Carol' } as any,
            );

            const name = await conversationsService.getSenderName('page-1', 'sender-1');

            expect(name).toBe('Carol');
        });

        it('returns null when no conversation exists', async () => {
            vi.mocked(db.query.conversations.findFirst).mockResolvedValue(undefined as any);

            const name = await conversationsService.getSenderName('page-1', 'sender-1');

            expect(name).toBeNull();
        });

        it('returns null when conversation exists but senderName is null', async () => {
            vi.mocked(db.query.conversations.findFirst).mockResolvedValue(
                { senderName: null } as any,
            );

            const name = await conversationsService.getSenderName('page-1', 'sender-1');

            expect(name).toBeNull();
        });
    });

    describe('findByPageAndSender', () => {
        it('returns a mapped conversation when found', async () => {
            vi.mocked(db.query.conversations.findFirst).mockResolvedValue(
                mockConvRow() as any,
            );

            const result = await conversationsService.findByPageAndSender('page-1', 'sender-1');

            expect(result).toMatchObject({
                id: 'conv-1',
                pageId: 'page-1',
                senderId: 'sender-1',
                senderName: 'Alice',
            });
        });

        it('returns null when no conversation exists', async () => {
            vi.mocked(db.query.conversations.findFirst).mockResolvedValue(undefined as any);

            const result = await conversationsService.findByPageAndSender('page-1', 'sender-1');

            expect(result).toBeNull();
        });
    });
});
