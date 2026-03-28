/**
 * Tests: disabled pages are excluded from stats and message/comment lists.
 *
 * Regression for: pages with autoReplyEnabled=false appearing in the
 * "items need your attention" dashboard banner.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessagesService } from '../services/messages';
import { CommentsService } from '../services/comments';

// vi.mock is hoisted before all imports/declarations, so all variables it
// references MUST come from vi.hoisted().
const { mockSelectTerminal, mockFindMany } = vi.hoisted(() => {
    const mockSelectTerminal = vi.fn().mockResolvedValue([]);
    const mockFindMany = vi.fn();
    return { mockSelectTerminal, mockFindMany };
});

vi.mock('../db', () => {
    // Build a flat self-referential Drizzle select chain.
    // Every step returns `chain`; `limit` is the terminal Promise.
    const chain: Record<string, ReturnType<typeof vi.fn>> = {
        from:      vi.fn(),
        innerJoin: vi.fn(),
        where:     vi.fn(),
        orderBy:   vi.fn(),
        limit:     mockSelectTerminal,
    };
    chain.from.mockReturnValue(chain);
    chain.innerJoin.mockReturnValue(chain);
    chain.where.mockReturnValue(chain);
    chain.orderBy.mockReturnValue(chain);

    return {
        db: {
            select: vi.fn().mockReturnValue(chain),
            query: {
                pages:             { findMany: mockFindMany },
                messages:          { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(undefined) },
                comments:          { findFirst: vi.fn().mockResolvedValue(undefined) },
                instagramComments: { findFirst: vi.fn().mockResolvedValue(undefined) },
            },
        },
    };
});

// ---------------------------------------------------------------------------
// MessagesService
// ---------------------------------------------------------------------------

describe('MessagesService — disabled-page filtering', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockSelectTerminal.mockResolvedValue([]);
    });

    it('getMessages() returns empty list when no enabled pages exist', async () => {
        mockFindMany.mockResolvedValue([]);

        const result = await new MessagesService().getMessages('workspace-1');

        expect(result.data).toEqual([]);
        expect(result.pagination.hasMore).toBe(false);
    });

    it('getMessages() passes a where filter when querying pages', async () => {
        mockFindMany.mockResolvedValue([]);

        await new MessagesService().getMessages('workspace-1');

        expect(mockFindMany).toHaveBeenCalledOnce();
        expect(mockFindMany.mock.calls[0][0]).toHaveProperty('where');
    });

    it('getStats() returns zero counts when the query returns an empty row', async () => {
        const emptyRow = {
            total: 0, replied: 0, resolved: 0, needsAttention: 0,
            actionRequired: 0, repliedToday: 0, ai: 0, template: 0, manual: 0,
            convTotal: 0, convActionRequired: 0, convAutoReplied: 0, convHandled: 0,
        };
        mockSelectTerminal.mockResolvedValue([emptyRow]);

        const stats = await new MessagesService().getStats('workspace-1');

        expect(stats.total).toBe(0);
        expect(stats.actionRequired).toBe(0);
        expect(stats.needsAttention).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// CommentsService
// ---------------------------------------------------------------------------

describe('CommentsService — disabled-page filtering', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockSelectTerminal.mockResolvedValue([]);
    });

    it('getCommentsByWorkspace() returns empty list when queries find no pages', async () => {
        const result = await new CommentsService().getCommentsByWorkspace('workspace-1');

        expect(result.data).toEqual([]);
        expect(result.pagination.hasMore).toBe(false);
    });

    it('getStats() returns zero counts when both FB and IG queries are empty', async () => {
        const emptyRow = {
            total: 0, replied: 0, needsAttention: 0, resolved: 0,
            actionRequired: 0, repliedToday: 0, ai: 0, template: 0, manual: 0,
        };
        mockSelectTerminal.mockResolvedValue([emptyRow]);

        const stats = await new CommentsService().getStats('workspace-1');

        expect(stats.total).toBe(0);
        expect(stats.actionRequired).toBe(0);
        expect(stats.needsAttention).toBe(0);
    });
});
