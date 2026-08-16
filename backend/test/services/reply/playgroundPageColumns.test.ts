import { describe, it, expect } from 'vitest';
import { PLAYGROUND_PAGE_COLUMNS } from '../../../src/services/reply/playgroundContext';

/**
 * D-084 pin, twin of platformPageMapping.test.ts: the playground preview
 * (admin/kb.ts) and the cache warmer (scripts/warm-reply-cache.ts) both spread
 * this ONE column subset instead of hand-listing pages columns. A
 * prompt-relevant column missing here produces a preview that answers with the
 * wrong context and a warmed `bv:` cache key production never reads — the
 * drift is silent because both paths "work", just differently from production.
 * This suite fails if a prompt-relevant column falls out of the shared subset.
 */
describe('PLAYGROUND_PAGE_COLUMNS — shared prompt-column subset', () => {
    it('carries every prompt-relevant column, including the page persona', () => {
        expect(Object.keys(PLAYGROUND_PAGE_COLUMNS)).toEqual(
            expect.arrayContaining([
                'knowledgeBase',
                'kbActiveVersion',
                'ecommerceStoreId',
                'businessProfile',
                'brandVoiceNotesMulti',
            ]),
        );
    });

    it('carries the identity columns the warm/preview paths key on', () => {
        expect(Object.keys(PLAYGROUND_PAGE_COLUMNS)).toEqual(
            expect.arrayContaining(['id', 'name', 'userId', 'workspaceId']),
        );
    });
});
