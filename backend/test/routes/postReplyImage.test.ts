import { describe, it, expect, vi, beforeEach } from 'vitest';
import fastify, { FastifyInstance } from 'fastify';

/**
 * Regression: a Post Reply image card lives in the customer's thread forever, but the storage
 * object behind it is deleted the moment the merchant replaces or clears the rule. Cards used to
 * embed the raw bucket URL, so every historical tap rendered Backblaze's `NoSuchKey` XML page.
 * The card now points at this resolver, which redirects to the CURRENT image.
 */

const selectMock = vi.fn();

vi.mock('../../src/db', () => ({
    db: { select: (...args: unknown[]) => selectMock(...args) },
}));

vi.mock('../../src/config', () => ({
    config: { publicApiBaseUrl: 'https://jawab24.com/api' },
}));

import postReplyImageRoutes from '../../src/routes/postReplyImage';

const POST_ID = '11111111-2222-3333-4444-555555555555';

/** Stub the drizzle chain: select().from().where().limit() → rows. */
function mockRows(rows: { imageUrl: string | null }[]) {
    selectMock.mockReturnValue({
        from: () => ({ where: () => ({ limit: () => Promise.resolve(rows) }) }),
    });
}

describe('GET /post-reply-image/:source/:id', () => {
    let app: FastifyInstance;

    beforeEach(async () => {
        vi.clearAllMocks();
        app = fastify();
        await app.register(postReplyImageRoutes);
        await app.ready();
    });

    it('redirects to the current image (302, uncacheable)', async () => {
        mockRows([{ imageUrl: 'https://s3.example/bucket/trigger-images/ws/new.jpg' }]);

        const res = await app.inject({ method: 'GET', url: `/post-reply-image/facebook/${POST_ID}` });

        expect(res.statusCode).toBe(302);
        expect(res.headers.location).toBe('https://s3.example/bucket/trigger-images/ws/new.jpg');
        // 301 or a cacheable 302 would pin the in-app browser to a key the merchant can delete.
        expect(res.headers['cache-control']).toBe('no-store');
    });

    it('follows the merchant to a REPLACED image — the old key is never re-exposed', async () => {
        mockRows([{ imageUrl: 'https://s3.example/bucket/trigger-images/ws/second.jpg' }]);

        const res = await app.inject({ method: 'GET', url: `/post-reply-image/facebook/${POST_ID}` });

        expect(res.headers.location).toContain('second.jpg');
    });

    it('resolves Instagram media from the instagram table', async () => {
        mockRows([{ imageUrl: 'https://s3.example/bucket/trigger-images/ws/ig.jpg' }]);

        const res = await app.inject({ method: 'GET', url: `/post-reply-image/instagram/${POST_ID}` });

        expect(res.statusCode).toBe(302);
        expect(res.headers.location).toContain('ig.jpg');
    });

    it('shows a bilingual notice (410) when the rule was cleared — never a bucket error page', async () => {
        mockRows([{ imageUrl: null }]);

        const res = await app.inject({ method: 'GET', url: `/post-reply-image/facebook/${POST_ID}` });

        expect(res.statusCode).toBe(410);
        expect(res.headers['content-type']).toContain('text/html');
        expect(res.body).toContain('لم تعد هذه الصورة متاحة.');
        expect(res.body).toContain('This image is no longer available.');
        expect(res.body).not.toContain('NoSuchKey');
    });

    it('404s an unknown post', async () => {
        mockRows([]);

        const res = await app.inject({ method: 'GET', url: `/post-reply-image/facebook/${POST_ID}` });

        expect(res.statusCode).toBe(404);
    });

    it('rejects a malformed id without touching the database (no uuid-cast 500)', async () => {
        const res = await app.inject({ method: 'GET', url: '/post-reply-image/facebook/not-a-uuid' });

        expect(res.statusCode).toBe(404);
        expect(selectMock).not.toHaveBeenCalled();
    });

    it('rejects an unknown source without touching the database', async () => {
        const res = await app.inject({ method: 'GET', url: `/post-reply-image/whatsapp/${POST_ID}` });

        expect(res.statusCode).toBe(404);
        expect(selectMock).not.toHaveBeenCalled();
    });
});
