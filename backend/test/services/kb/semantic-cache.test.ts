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
                'PRICE',
                1,
            );

            expect(result).toBeNull();
            expect(db.execute).toHaveBeenCalledTimes(1);
        });

        it('returns cached reply when a matching row exists', async () => {
            (db.execute as ReturnType<typeof vi.fn>).mockResolvedValue([
                {
                    id: 'cache-1',
                    reply_text: 'The roses cost $50',
                    intent: 'PRICE',
                    metadata: { confidence: 'high', flags: [] },
                    similarity: 0.95,
                },
            ]);

            const result = await service.check(
                'page-1',
                [0.1, 0.2, 0.3],
                'PRICE',
                1,
            );

            expect(result).not.toBeNull();
            expect(result!.reply).toBe('The roses cost $50');
            expect(result!.intent).toBe('PRICE');
            expect(result!.confidence).toBe('high');
            expect(result!.flags).toEqual([]);
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

    describe('save', () => {
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
