import { describe, it, expect, vi, beforeEach } from 'vitest';

// fbAxios + crypto are the only external touch points; mock them.
vi.mock('../../src/lib/fbAxios', () => ({
    fbAxios: { post: vi.fn().mockResolvedValue({ data: {} }), delete: vi.fn().mockResolvedValue({ data: {} }) },
    GRAPH_API_BASE: 'https://graph.facebook.com/v18.0',
}));
vi.mock('../../src/services/facebookCrypto', () => ({
    maybeDecryptToken: (t: string) => t,
}));
vi.mock('../../src/services/auditLog', () => ({
    auditLog: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/utils/sentryHelpers', () => ({
    captureError: vi.fn(),
}));

// Stub the DB query builder. resolveFbTarget runs select().from().innerJoin().innerJoin().where().limit()
// and update().set().where(); we drive the results per-test via the mocks below.
const fbRows: any[] = [];
const igRows: any[] = [];
const updateSpy = vi.fn().mockResolvedValue(undefined);
const deleteSpy = vi.fn().mockResolvedValue(undefined);

vi.mock('../../src/db', () => ({
    db: {
        select: (cols: any) => {
            // The IG existence check selects only { id }; the FB target select has more columns.
            const isIgCheck = cols && Object.keys(cols).length === 1 && 'id' in cols;
            const chain: any = {
                from: () => chain,
                innerJoin: () => chain,
                where: () => chain,
                limit: () => Promise.resolve(isIgCheck ? igRows : fbRows),
            };
            return chain;
        },
        update: () => ({ set: () => ({ where: updateSpy }) }),
        delete: () => ({ where: deleteSpy }),
    },
}));

vi.mock('../../src/db/schema', () => ({
    comments: { id: 'comments.id', postId: 'comments.postId', workspaceId: 'comments.workspaceId', facebookCommentId: 'fcid', fromId: 'fromId', hiddenAt: 'h', moderationAction: 'ma', moderatedBy: 'mb', updatedAt: 'u' },
    instagramComments: { id: 'ig.id', workspaceId: 'ig.workspaceId' },
    posts: { id: 'posts.id', pageId: 'posts.pageId' },
    pages: { id: 'pages.id', facebookPageId: 'pages.fpid', accessToken: 'pages.token' },
}));

import { commentModeration } from '../../src/services/commentModeration';
import { fbAxios } from '../../src/lib/fbAxios';

function setFbRow(row: any | null) {
    fbRows.length = 0;
    if (row) fbRows.push(row);
}
function setIgRow(present: boolean) {
    igRows.length = 0;
    if (present) igRows.push({ id: 'ig-1' });
}

const REAL_ROW = { facebookCommentId: 'fb_c_1', fromId: 'fb_user_9', facebookPageId: 'fb_page_1', accessToken: 'tok' };
const DEMO_ROW = { facebookCommentId: 'demo_comment_3', fromId: 'fb_user_9', facebookPageId: 'demo_page_x', accessToken: 'tok' };

beforeEach(() => {
    vi.clearAllMocks();
    setFbRow(null);
    setIgRow(false);
});

describe('commentModeration', () => {
    describe('hide', () => {
        it('hides on the platform and marks the row hidden', async () => {
            setFbRow(REAL_ROW);
            const res = await commentModeration.hide('row-1', 'ws-1', 'user-7');

            expect(res.status).toBe('ok');
            expect(fbAxios.post).toHaveBeenCalledWith(
                'https://graph.facebook.com/v18.0/fb_c_1',
                null,
                { params: { is_hidden: true, access_token: 'tok' } },
            );
            expect(updateSpy).toHaveBeenCalled();
        });

        it('skips the Graph call for demo pages but still updates the row', async () => {
            setFbRow(DEMO_ROW);
            const res = await commentModeration.hide('row-1', 'ws-1', 'auto');

            expect(res.status).toBe('ok');
            expect(fbAxios.post).not.toHaveBeenCalled();
            expect(updateSpy).toHaveBeenCalled();
        });

        it('returns not_found when the row is neither FB nor IG', async () => {
            setFbRow(null);
            setIgRow(false);
            const res = await commentModeration.hide('missing', 'ws-1', 'user-7');
            expect(res.status).toBe('not_found');
        });

        it('returns unsupported_platform for an Instagram comment', async () => {
            setFbRow(null);
            setIgRow(true);
            const res = await commentModeration.hide('ig-1', 'ws-1', 'user-7');
            expect(res.status).toBe('unsupported_platform');
        });
    });

    describe('remove', () => {
        it('deletes on the platform then removes the row', async () => {
            setFbRow(REAL_ROW);
            const res = await commentModeration.remove('row-1', 'ws-1', 'user-7');

            expect(res.status).toBe('ok');
            expect(fbAxios.delete).toHaveBeenCalledWith(
                'https://graph.facebook.com/v18.0/fb_c_1',
                { params: { access_token: 'tok' } },
            );
            expect(deleteSpy).toHaveBeenCalled();
        });
    });

    describe('blockAuthor', () => {
        it('blocks the author via the page /blocked edge', async () => {
            setFbRow(REAL_ROW);
            const res = await commentModeration.blockAuthor('row-1', 'ws-1');

            expect(res.status).toBe('ok');
            expect(res.blockedUserId).toBe('fb_user_9');
            expect(fbAxios.post).toHaveBeenCalledWith(
                'https://graph.facebook.com/v18.0/fb_page_1/blocked',
                null,
                { params: { psid: 'fb_user_9', access_token: 'tok' } },
            );
        });

        it('returns no_identity when the commenter id is unknown', async () => {
            setFbRow({ ...REAL_ROW, fromId: null });
            const res = await commentModeration.blockAuthor('row-1', 'ws-1');

            expect(res.status).toBe('no_identity');
            expect(fbAxios.post).not.toHaveBeenCalled();
        });
    });

    describe('autoModerateOffensive', () => {
        it('blocks then hides and returns true (action=hide)', async () => {
            setFbRow(REAL_ROW);
            const handled = await commentModeration.autoModerateOffensive('row-1', 'ws-1', 'page-owner', { action: 'hide', blockAuthor: true });

            expect(handled).toBe(true);
            // block POST (/blocked) + hide POST (is_hidden) both fired
            expect(fbAxios.post).toHaveBeenCalledWith(expect.stringContaining('/blocked'), null, expect.anything());
            expect(fbAxios.post).toHaveBeenCalledWith('https://graph.facebook.com/v18.0/fb_c_1', null, { params: { is_hidden: true, access_token: 'tok' } });
            expect(updateSpy).toHaveBeenCalled();
            expect(deleteSpy).not.toHaveBeenCalled();
        });

        it('blocks then deletes and returns true (action=delete)', async () => {
            setFbRow(REAL_ROW);
            const handled = await commentModeration.autoModerateOffensive('row-1', 'ws-1', 'page-owner', { action: 'delete', blockAuthor: true });

            expect(handled).toBe(true);
            expect(fbAxios.delete).toHaveBeenCalled();
            expect(deleteSpy).toHaveBeenCalled();
        });

        it('does not block when blockAuthor is false', async () => {
            setFbRow(REAL_ROW);
            await commentModeration.autoModerateOffensive('row-1', 'ws-1', 'page-owner', { action: 'hide', blockAuthor: false });

            expect(fbAxios.post).not.toHaveBeenCalledWith(expect.stringContaining('/blocked'), null, expect.anything());
        });

        it('returns false (fall-through) for a non-Facebook comment', async () => {
            setFbRow(null);
            setIgRow(true);
            const handled = await commentModeration.autoModerateOffensive('ig-1', 'ws-1', 'page-owner', { action: 'hide', blockAuthor: true });

            expect(handled).toBe(false);
        });

        it('is fail-safe: returns false when a Graph call throws', async () => {
            setFbRow(REAL_ROW);
            vi.mocked(fbAxios.post).mockRejectedValueOnce(Object.assign(new Error('boom'), { isAxiosError: true }));
            const handled = await commentModeration.autoModerateOffensive('row-1', 'ws-1', 'page-owner', { action: 'hide', blockAuthor: true });

            expect(handled).toBe(false);
        });
    });
});
