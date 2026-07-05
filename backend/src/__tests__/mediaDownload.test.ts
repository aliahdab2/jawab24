import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fetchMediaBuffer, MediaDownloadError } from '../utils/mediaDownload';

function mockResponse(opts: { ok?: boolean; status?: number; contentLength?: number; contentType?: string; body?: Buffer }) {
    const { ok = true, status = 200, contentLength, contentType, body = Buffer.from('data') } = opts;
    const headers: Record<string, string | undefined> = {
        'content-length': contentLength !== undefined ? String(contentLength) : undefined,
        'content-type': contentType,
    };
    return {
        ok,
        status,
        headers: { get: (h: string) => headers[h.toLowerCase()] ?? null },
        arrayBuffer: async () => body,
    };
}

beforeEach(() => {
    (globalThis as unknown as { fetch: ReturnType<typeof vi.fn> }).fetch = vi.fn();
});

describe('fetchMediaBuffer', () => {
    it('returns the buffer and lowercased content-type on success', async () => {
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
            mockResponse({ contentLength: 4, contentType: 'IMAGE/JPEG', body: Buffer.from('abcd') }),
        );
        const { buffer, contentType } = await fetchMediaBuffer('https://cdn/x', { maxBytes: 1000, timeoutMs: 1000 });
        expect(buffer.toString()).toBe('abcd');
        expect(contentType).toBe('image/jpeg');
    });

    it('defaults content-type to empty string when the header is absent', async () => {
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse({ contentLength: 4 }));
        const { contentType } = await fetchMediaBuffer('https://cdn/x', { maxBytes: 1000, timeoutMs: 1000 });
        expect(contentType).toBe('');
    });

    it('throws not_ok (with status) on a non-2xx response', async () => {
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse({ ok: false, status: 403 }));
        await expect(fetchMediaBuffer('https://cdn/x', { maxBytes: 1000, timeoutMs: 1000 })).rejects.toMatchObject({
            reason: 'not_ok',
            status: 403,
        });
    });

    it('throws too_large from the content-length header without reading the body', async () => {
        const arrayBuffer = vi.fn();
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
            ok: true,
            status: 200,
            headers: { get: (h: string) => (h.toLowerCase() === 'content-length' ? '5000' : null) },
            arrayBuffer,
        });
        await expect(fetchMediaBuffer('https://cdn/x', { maxBytes: 1000, timeoutMs: 1000 })).rejects.toBeInstanceOf(MediaDownloadError);
        expect(arrayBuffer).not.toHaveBeenCalled();
    });

    it('throws too_large from the actual buffer when no content-length header is present', async () => {
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse({ body: Buffer.alloc(2000) }));
        await expect(fetchMediaBuffer('https://cdn/x', { maxBytes: 1000, timeoutMs: 1000 })).rejects.toMatchObject({ reason: 'too_large' });
    });

    it('throws timeout when the fetch aborts', async () => {
        const abortErr = new Error('aborted');
        abortErr.name = 'AbortError';
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(abortErr);
        await expect(fetchMediaBuffer('https://cdn/x', { maxBytes: 1000, timeoutMs: 1000 })).rejects.toMatchObject({ reason: 'timeout' });
    });

    it('throws network on any other fetch error', async () => {
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('ECONNRESET'));
        await expect(fetchMediaBuffer('https://cdn/x', { maxBytes: 1000, timeoutMs: 1000 })).rejects.toMatchObject({ reason: 'network' });
    });
});
