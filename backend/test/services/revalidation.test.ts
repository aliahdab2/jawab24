import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    PLAN_DEPENDENT_PATHS,
    revalidatePlanPages,
    revalidatePublicPages,
} from '../../src/services/revalidation';

const REVALIDATE_URL = 'https://jawab24.com/api/revalidate';
const REVALIDATE_SECRET = 'test-secret';

describe('revalidatePublicPages', () => {
    let fetchMock: ReturnType<typeof vi.fn>;
    let warnSpy: ReturnType<typeof vi.spyOn>;
    let infoSpy: ReturnType<typeof vi.spyOn>;
    const originalUrl = process.env.FRONTEND_REVALIDATE_URL;
    const originalSecret = process.env.REVALIDATE_SECRET;

    beforeEach(() => {
        fetchMock = vi.fn();
        global.fetch = fetchMock as unknown as typeof fetch;
        warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
        process.env.FRONTEND_REVALIDATE_URL = REVALIDATE_URL;
        process.env.REVALIDATE_SECRET = REVALIDATE_SECRET;
    });

    afterEach(() => {
        warnSpy.mockRestore();
        infoSpy.mockRestore();
        if (originalUrl === undefined) delete process.env.FRONTEND_REVALIDATE_URL;
        else process.env.FRONTEND_REVALIDATE_URL = originalUrl;
        if (originalSecret === undefined) delete process.env.REVALIDATE_SECRET;
        else process.env.REVALIDATE_SECRET = originalSecret;
    });

    it('exposes both locale variants of the pricing page', () => {
        expect(PLAN_DEPENDENT_PATHS).toEqual(['/pricing', '/en/pricing']);
    });

    it('returns immediately when paths is empty without calling fetch', async () => {
        await revalidatePublicPages([]);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('skips revalidation and warns when env vars are missing', async () => {
        delete process.env.FRONTEND_REVALIDATE_URL;
        await revalidatePublicPages(['/pricing']);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining('FRONTEND_REVALIDATE_URL or REVALIDATE_SECRET not set'),
        );
    });

    it('POSTs to the configured URL with secret header and paths body', async () => {
        fetchMock.mockResolvedValue({ ok: true, status: 200, statusText: 'OK' });

        await revalidatePublicPages(['/pricing', '/en/pricing']);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [calledUrl, init] = fetchMock.mock.calls[0];
        expect(calledUrl).toBe(REVALIDATE_URL);
        expect(init.method).toBe('POST');
        expect(init.headers['x-revalidate-secret']).toBe(REVALIDATE_SECRET);
        expect(init.headers['content-type']).toBe('application/json');
        expect(JSON.parse(init.body)).toEqual({ paths: ['/pricing', '/en/pricing'] });
    });

    it('does not throw when the frontend returns a non-2xx response', async () => {
        fetchMock.mockResolvedValue({ ok: false, status: 503, statusText: 'Service Unavailable' });

        await expect(revalidatePublicPages(['/pricing'])).resolves.toBeUndefined();
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining('Frontend returned 503'),
        );
    });

    it('does not throw when fetch rejects (network failure)', async () => {
        fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

        await expect(revalidatePublicPages(['/pricing'])).resolves.toBeUndefined();
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining('Request failed for paths /pricing'),
            expect.stringContaining('ECONNREFUSED'),
        );
    });

    it('revalidatePlanPages forwards every plan-dependent path', async () => {
        fetchMock.mockResolvedValue({ ok: true, status: 200, statusText: 'OK' });

        await revalidatePlanPages();

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const init = fetchMock.mock.calls[0][1];
        expect(JSON.parse(init.body)).toEqual({ paths: [...PLAN_DEPENDENT_PATHS] });
    });
});
