import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';
import handler from '../../src/pages/api/revalidate';

const SECRET = 'test-revalidate-secret';

interface MockRes {
    statusCode: number;
    body: unknown;
    headers: Record<string, string>;
    revalidate: ReturnType<typeof vi.fn>;
}

function buildReq(overrides: Partial<NextApiRequest> = {}): NextApiRequest {
    return {
        method: 'POST',
        headers: { 'x-revalidate-secret': SECRET },
        body: { paths: ['/pricing'] },
        ...overrides,
    } as NextApiRequest;
}

function buildRes(revalidateImpl?: (path: string) => Promise<void> | void): NextApiResponse & MockRes {
    const headers: Record<string, string> = {};
    const res: Partial<NextApiResponse> & MockRes = {
        statusCode: 200,
        body: undefined,
        headers,
        revalidate: vi.fn(revalidateImpl ?? (() => Promise.resolve())),
        setHeader: vi.fn((name: string, value: string) => {
            headers[name.toLowerCase()] = value;
            return res as NextApiResponse;
        }),
        status(code: number) {
            (res as MockRes).statusCode = code;
            return res as NextApiResponse;
        },
        json(payload: unknown) {
            (res as MockRes).body = payload;
            return res as NextApiResponse;
        },
    };
    return res as NextApiResponse & MockRes;
}

describe('/api/revalidate', () => {
    const originalSecret = process.env.REVALIDATE_SECRET;

    beforeEach(() => {
        process.env.REVALIDATE_SECRET = SECRET;
    });

    afterEach(() => {
        if (originalSecret === undefined) delete process.env.REVALIDATE_SECRET;
        else process.env.REVALIDATE_SECRET = originalSecret;
    });

    it('returns 405 for non-POST requests and advertises Allow header', async () => {
        const req = buildReq({ method: 'GET' });
        const res = buildRes();

        await handler(req, res);

        expect(res.statusCode).toBe(405);
        expect(res.setHeader).toHaveBeenCalledWith('Allow', 'POST');
        expect(res.revalidate).not.toHaveBeenCalled();
    });

    it('returns 500 when REVALIDATE_SECRET is not configured on the frontend', async () => {
        delete process.env.REVALIDATE_SECRET;
        const res = buildRes();

        await handler(buildReq(), res);

        expect(res.statusCode).toBe(500);
        expect(res.revalidate).not.toHaveBeenCalled();
    });

    it('returns 401 when secret is missing', async () => {
        const req = buildReq({ headers: {} });
        const res = buildRes();

        await handler(req, res);

        expect(res.statusCode).toBe(401);
        expect(res.revalidate).not.toHaveBeenCalled();
    });

    it('returns 401 when secret is wrong (and same length to exercise the comparison)', async () => {
        const req = buildReq({ headers: { 'x-revalidate-secret': 'X'.repeat(SECRET.length) } });
        const res = buildRes();

        await handler(req, res);

        expect(res.statusCode).toBe(401);
        expect(res.revalidate).not.toHaveBeenCalled();
    });

    it('returns 401 when secret is wrong length (timingSafeEqual would otherwise throw)', async () => {
        const req = buildReq({ headers: { 'x-revalidate-secret': 'short' } });
        const res = buildRes();

        await handler(req, res);

        expect(res.statusCode).toBe(401);
        expect(res.revalidate).not.toHaveBeenCalled();
    });

    it('returns 400 when paths array is missing or empty', async () => {
        const res = buildRes();
        await handler(buildReq({ body: {} }), res);
        expect(res.statusCode).toBe(400);

        const res2 = buildRes();
        await handler(buildReq({ body: { paths: [] } }), res2);
        expect(res2.statusCode).toBe(400);
    });

    it('revalidates each path and returns 200 on full success', async () => {
        const res = buildRes();
        await handler(buildReq({ body: { paths: ['/pricing', '/en/pricing'] } }), res);

        expect(res.revalidate).toHaveBeenCalledTimes(2);
        expect(res.revalidate).toHaveBeenNthCalledWith(1, '/pricing');
        expect(res.revalidate).toHaveBeenNthCalledWith(2, '/en/pricing');
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({
            results: [
                { path: '/pricing', revalidated: true },
                { path: '/en/pricing', revalidated: true },
            ],
        });
    });

    it('rejects paths that do not start with / without invoking revalidate', async () => {
        const res = buildRes();
        await handler(buildReq({ body: { paths: ['pricing'] } }), res);

        expect(res.revalidate).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(207);
        expect((res.body as { results: Array<{ revalidated: boolean; error?: string }> }).results[0].error).toMatch(/start with \//);
    });

    it('returns 207 multi-status when one path succeeds and another fails', async () => {
        const failingPath = '/missing';
        const res = buildRes((path) => {
            if (path === failingPath) return Promise.reject(new Error('boom'));
            return Promise.resolve();
        });

        await handler(buildReq({ body: { paths: ['/pricing', failingPath] } }), res);

        expect(res.statusCode).toBe(207);
        const body = res.body as { results: Array<{ path: string; revalidated: boolean; error?: string }> };
        expect(body.results[0]).toEqual({ path: '/pricing', revalidated: true });
        expect(body.results[1].path).toBe(failingPath);
        expect(body.results[1].revalidated).toBe(false);
        expect(body.results[1].error).toBe('boom');
    });
});
