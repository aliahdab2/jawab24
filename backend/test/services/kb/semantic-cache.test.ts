import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock db before importing the service
vi.mock('../../../src/db', () => ({
    db: {
        execute: vi.fn(),
    },
}));

import { SemanticCacheService } from '../../../src/services/kb/semantic-cache';
import { db } from '../../../src/db';

describe('SemanticCacheService', () => {
    let service: SemanticCacheService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new SemanticCacheService();
    });

    describe('check', () => {
        it('returns null when no matching rows', async () => {
            (db.execute as ReturnType<typeof vi.fn>).mockResolvedValue([]);

            const result = await service.check(
                'page-1',
                [0.1, 0.2, 0.3],
                'GREETING',
                1,
            );

            expect(result).toBeNull();
            expect(db.execute).toHaveBeenCalledTimes(1);
        });

        it('returns cached reply when a matching row exists', async () => {
            (db.execute as ReturnType<typeof vi.fn>).mockResolvedValue([
                {
                    id: 'cache-1',
                    reply_text: 'We are open 9-6',
                    intent: 'HOURS',
                    metadata: { confidence: 'high', flags: [] },
                    similarity: 0.95,
                },
            ]);

            const result = await service.check(
                'page-1',
                [0.1, 0.2, 0.3],
                'HOURS',
                1,
            );

            expect(result).not.toBeNull();
            expect(result!.reply).toBe('We are open 9-6');
            expect(result!.intent).toBe('HOURS');
            expect(result!.confidence).toBe('high');
            expect(result!.flags).toEqual([]);
        });

        it('skips semantic cache for PRICE intent', async () => {
            const result = await service.check(
                'page-1',
                [0.1, 0.2, 0.3],
                'PRICE',
                1,
            );

            expect(result).toBeNull();
            // DB should NOT be queried — intent-based skip
            expect(db.execute).not.toHaveBeenCalled();
        });

        it('skips semantic cache for PURCHASE_INTENT', async () => {
            const result = await service.check(
                'page-1',
                [0.1, 0.2, 0.3],
                'PURCHASE_INTENT',
                1,
            );

            expect(result).toBeNull();
            expect(db.execute).not.toHaveBeenCalled();
        });

        it('does NOT skip semantic cache for GREETING intent', async () => {
            (db.execute as ReturnType<typeof vi.fn>).mockResolvedValue([
                {
                    id: 'cache-g',
                    reply_text: 'Hello!',
                    intent: 'GREETING',
                    metadata: { confidence: 'high', flags: [] },
                    similarity: 0.95,
                },
            ]);

            const result = await service.check('page-1', [0.1, 0.2], 'GREETING', 1);
            expect(result).not.toBeNull();
            // DB was queried (SELECT + fire-and-forget hit count UPDATE)
            expect(db.execute).toHaveBeenCalled();
        });

        it('does NOT skip semantic cache for QUESTION intent', async () => {
            (db.execute as ReturnType<typeof vi.fn>).mockResolvedValue([]);

            await service.check('page-1', [0.1, 0.2], 'QUESTION', 1);
            expect(db.execute).toHaveBeenCalledTimes(1);
        });

        it('returns null on database error', async () => {
            (db.execute as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('DB down'));

            const result = await service.check(
                'page-1',
                [0.1, 0.2, 0.3],
                'PRICE',
                1,
            );

            expect(result).toBeNull();
        });

        it('handles null metadata gracefully', async () => {
            (db.execute as ReturnType<typeof vi.fn>).mockResolvedValue([
                {
                    id: 'cache-2',
                    reply_text: 'Some reply',
                    intent: 'OTHER',
                    metadata: null,
                    similarity: 0.94,
                },
            ]);

            const result = await service.check(
                'page-1',
                [0.1, 0.2, 0.3],
                'OTHER',
                1,
            );

            expect(result).not.toBeNull();
            expect(result!.reply).toBe('Some reply');
            expect(result!.confidence).toBeUndefined();
            expect(result!.flags).toBeUndefined();
        });
    });

    describe('check - brand voice scoping', () => {
        // Brand voice is prompt-injected but settings saves never bump
        // kbActiveVersion, so the brandVoiceHash metadata filter is the only thing
        // preventing old-voice replies after a merchant rewrites their voice.
        const rowWith = (metadata: Record<string, unknown> | null) => [{
            id: 'cache-bv',
            reply_text: 'Branded reply',
            intent: 'HOURS',
            metadata,
            similarity: 0.95,
        }];

        it('hits when row hash matches the current brand voice hash', async () => {
            (db.execute as ReturnType<typeof vi.fn>).mockResolvedValue(rowWith({ brandVoiceHash: 'abc12345' }));

            const result = await service.check('page-1', [0.1], 'HOURS', 1, { brandVoiceHash: 'abc12345' });
            expect(result).not.toBeNull();
        });

        it('misses when row hash differs from the current brand voice hash', async () => {
            (db.execute as ReturnType<typeof vi.fn>).mockResolvedValue(rowWith({ brandVoiceHash: 'abc12345' }));

            const result = await service.check('page-1', [0.1], 'HOURS', 1, { brandVoiceHash: 'zzz99999' });
            expect(result).toBeNull();
        });

        it('misses legacy rows (no hash) when the workspace now has a brand voice', async () => {
            (db.execute as ReturnType<typeof vi.fn>).mockResolvedValue(rowWith({ confidence: 'high' }));

            const result = await service.check('page-1', [0.1], 'HOURS', 1, { brandVoiceHash: 'abc12345' });
            expect(result).toBeNull();
        });

        it('misses voice-tagged rows when the workspace has no brand voice', async () => {
            (db.execute as ReturnType<typeof vi.fn>).mockResolvedValue(rowWith({ brandVoiceHash: 'abc12345' }));

            const result = await service.check('page-1', [0.1], 'HOURS', 1);
            expect(result).toBeNull();
        });

        it('hits legacy rows when the workspace has no brand voice', async () => {
            (db.execute as ReturnType<typeof vi.fn>).mockResolvedValue(rowWith({ confidence: 'high' }));

            const result = await service.check('page-1', [0.1], 'HOURS', 1);
            expect(result).not.toBeNull();
        });
    });

    describe('save', () => {
        /**
         * The drizzle SQL object passed to db.execute interleaves StringChunks
         * (which carry a `value` key) and raw param values in queryChunks. The
         * metadata object is the only plain-object param in the INSERT — every
         * other param is a string or number — so find it by shape.
         */
        const executedMetadataParam = (): Record<string, unknown> | undefined => {
            const sqlArg = (db.execute as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
                queryChunks: unknown[];
            };
            return sqlArg.queryChunks.find(
                (c): c is Record<string, unknown> =>
                    !!c && typeof c === 'object' && !Array.isArray(c) && !('value' in c),
            );
        };

        it('inserts a new cache entry', async () => {
            (db.execute as ReturnType<typeof vi.fn>).mockResolvedValue([]);

            await service.save({
                pageId: 'page-1',
                queryText: 'How much are the roses?',
                queryEmbedding: [0.1, 0.2, 0.3],
                intent: 'PRICE',
                replyText: 'The roses cost $50',
                kbActiveVersion: 1,
                metadata: { confidence: 'high', flags: [] },
            });

            expect(db.execute).toHaveBeenCalledTimes(1);
        });

        it('stores brandVoiceHash in metadata when provided', async () => {
            // Guards the save side of brand-voice scoping: if the hash silently
            // stopped being written, voice-having workspaces would never hit the
            // semantic cache again (legacy-row rule) with no test failing.
            (db.execute as ReturnType<typeof vi.fn>).mockResolvedValue([]);

            await service.save({
                pageId: 'page-1',
                queryText: 'When do you open?',
                queryEmbedding: [0.1],
                intent: 'HOURS',
                replyText: 'We open at 9',
                kbActiveVersion: 1,
                brandVoiceHash: 'abc12345',
            });

            const metadataParam = executedMetadataParam();
            expect(metadataParam).toBeDefined();
            expect(metadataParam!.brandVoiceHash).toBe('abc12345');
        });

        it('omits brandVoiceHash from metadata when absent', async () => {
            (db.execute as ReturnType<typeof vi.fn>).mockResolvedValue([]);

            await service.save({
                pageId: 'page-1',
                queryText: 'When do you open?',
                queryEmbedding: [0.1],
                intent: 'HOURS',
                replyText: 'We open at 9',
                kbActiveVersion: 1,
            });

            const metadataParam = executedMetadataParam();
            expect(metadataParam).toBeDefined();
            expect(metadataParam).not.toHaveProperty('brandVoiceHash');
        });

        it('does not throw on save failure', async () => {
            (db.execute as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('DB error'));

            // Should not throw
            await expect(service.save({
                pageId: 'page-1',
                queryText: 'test',
                queryEmbedding: [0.1],
                intent: 'OTHER',
                replyText: 'reply',
                kbActiveVersion: 1,
            })).resolves.not.toThrow();
        });
    });

    describe('invalidateByPage', () => {
        it('deletes all entries for a page', async () => {
            (db.execute as ReturnType<typeof vi.fn>).mockResolvedValue([]);

            await service.invalidateByPage('page-1');

            expect(db.execute).toHaveBeenCalledTimes(1);
        });
    });
});
