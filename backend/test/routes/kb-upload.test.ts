/**
 * Route-level tests for POST /kb/extract-text — the PDF branches.
 *
 * What is pinned here is the contract the extractor cannot see on its own:
 * a text layer we already hold is returned to the merchant whenever Vision
 * cannot run — denied by the plan/quota gate OR failed mid-call — and Vision
 * revisits only the pages `extractFromPDF` named.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const mocks = vi.hoisted(() => ({
    getUserSubscription: vi.fn(),
    checkDailyCap: vi.fn(),
    incrementDailyCap: vi.fn(),
    captureError: vi.fn(),
    extractFromPDF: vi.fn(),
    extractFromPdfViaVision: vi.fn(),
    extractFromImage: vi.fn(),
}));

vi.mock('../../src/middleware/auth', () => ({
    authenticate: vi.fn(async (request: { user?: unknown }) => {
        request.user = { userId: 'user-1' };
    }),
}));
vi.mock('../../src/middleware/workspace', () => ({
    resolveWorkspace: vi.fn(async () => undefined),
    requireRole: () => async () => undefined,
}));
vi.mock('../../src/services/subscriptions', () => ({
    subscriptionsService: { getUserSubscription: mocks.getUserSubscription },
}));
vi.mock('../../src/lib/dailyCap', () => ({
    checkDailyCap: mocks.checkDailyCap,
    incrementDailyCap: mocks.incrementDailyCap,
    dailyCapKey: (prefix: string, id: string) => `${prefix}:${id}`,
}));
vi.mock('../../src/utils/sentryHelpers', () => ({ captureError: mocks.captureError }));
vi.mock('../../src/utils/swagger', () => ({ auth: [] }));
vi.mock('../../src/services/openaiClient', () => ({
    BadRequestError: class BadRequestError extends Error {},
}));
vi.mock('../../src/services/kb/file-extractor', () => ({
    extractFromPDF: mocks.extractFromPDF,
    extractFromPdfViaVision: mocks.extractFromPdfViaVision,
    extractFromImage: mocks.extractFromImage,
    extractFromWord: vi.fn(),
    extractFromSpreadsheet: vi.fn(),
    bufferMatchesMime: () => true,
    SUPPORTED_MIME_TYPES: new Set(['application/pdf']),
    VISION_MIME_TYPES: new Set(['image/png']),
    SPREADSHEET_MIME_TYPES: new Set<string>(),
    MAX_FILE_SIZE_BYTES: 5 * 1024 * 1024,
}));

import kbUploadRoutes from '../../src/routes/kb-upload';

const PAGE_TEXTS = [
    'صفحة 1: نص طويل بما يكفي ليتجاوز حد المسح الضوئي في هذا الاختبار',
    'الخدمة\tالمدة\tالسعر\nكشف عام\t20 دقيقة\t150\nتنظيف\t45 دقيقة\t300\nحشوة\t60 دقيقة\t450',
    'صفحة 3: نص طويل بما يكفي ليتجاوز حد المسح الضوئي في هذا الاختبار',
];

/** What `extractFromPDF` returns for a text-layer PDF with a table on page 2. */
const layerResult = () => ({
    text: PAGE_TEXTS.join('\n\n'),
    method: 'pdfjs' as const,
    isScanned: false,
    tabular: true,
    truncated: false,
    pagesRead: 3,
    pagesTotal: 3,
    pagesTruncated: false,
    pageTexts: [...PAGE_TEXTS],
    visionPages: [1],
});

/** What `extractFromPDF` returns for a scanned PDF (no text layer anywhere). */
const scannedResult = () => ({
    text: '',
    method: 'pdfjs' as const,
    isScanned: true,
    pagesRead: 2,
    pagesTotal: 2,
    pagesTruncated: false,
});

let app: FastifyInstance;

async function post() {
    return app.inject({
        method: 'POST',
        url: '/kb/extract-text',
        payload: {
            file: Buffer.from('%PDF-1.4 fake').toString('base64'),
            mimeType: 'application/pdf',
            fileName: 'manual.pdf',
        },
    });
}

describe('POST /kb/extract-text — PDF branches', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        mocks.getUserSubscription.mockResolvedValue({ plan: { ecommerceEnabled: true, slug: 'business' } });
        mocks.checkDailyCap.mockResolvedValue({ allowed: true, used: 0 });
        mocks.incrementDailyCap.mockResolvedValue(undefined);
        app = Fastify();
        await app.register(kbUploadRoutes, { prefix: '/kb' });
        await app.ready();
    });

    afterAll(async () => {
        await app.close();
    });

    it('returns the text layer when Vision fails mid-call, and reports the failure', async () => {
        mocks.extractFromPDF.mockResolvedValue(layerResult());
        mocks.extractFromPdfViaVision.mockRejectedValue(new Error('OpenAI 503'));

        const res = await post();

        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body.success).toBe(true);
        expect(body.data.text).toBe(PAGE_TEXTS.join('\n\n'));
        expect(body.data.method).toBe('pdfjs');
        expect(body.data.tabular).toBe(true);
        // Reported, not swallowed — and no quota spent on a call that failed.
        expect(mocks.captureError).toHaveBeenCalledTimes(1);
        expect(mocks.captureError.mock.calls[0][2]).toMatchObject({ level: 'warning' });
        expect(mocks.incrementDailyCap).not.toHaveBeenCalled();
    });

    it('still fails a scanned PDF (nothing to fall back on) when Vision fails', async () => {
        mocks.extractFromPDF.mockResolvedValue(scannedResult());
        mocks.extractFromPdfViaVision.mockRejectedValue(new Error('OpenAI 503'));

        const res = await post();

        expect(res.statusCode).toBe(500);
        expect(mocks.captureError).not.toHaveBeenCalled();
    });

    it('returns the text layer when the plan gate denies Vision; a scanned PDF still gets the 403', async () => {
        mocks.getUserSubscription.mockResolvedValue({ plan: { ecommerceEnabled: false } });

        mocks.extractFromPDF.mockResolvedValue(layerResult());
        const withLayer = await post();
        expect(withLayer.statusCode).toBe(200);
        expect(withLayer.json().data.text).toBe(PAGE_TEXTS.join('\n\n'));
        expect(mocks.extractFromPdfViaVision).not.toHaveBeenCalled();

        mocks.extractFromPDF.mockResolvedValue(scannedResult());
        const scanned = await post();
        expect(scanned.statusCode).toBe(403);
        expect(scanned.json()).toMatchObject({ error: 'plan_upgrade_required' });
    });

    it('sends Vision only the pages extractFromPDF named, with their layers, and keeps the PDF verdicts on the result', async () => {
        mocks.extractFromPDF.mockResolvedValue(layerResult());
        mocks.extractFromPdfViaVision.mockResolvedValue({
            text: 'merged',
            method: 'pdfjs+gpt-vision',
            truncated: false,
            pagesRead: 3,
            pagesTotal: 3,
            pagesTruncated: false,
            visionPages: [1],
        });

        const res = await post();

        expect(res.statusCode).toBe(200);
        const [, ctx, opts] = mocks.extractFromPdfViaVision.mock.calls[0];
        expect(opts).toEqual({ pageTexts: PAGE_TEXTS, pages: [1] });
        expect(ctx).toMatchObject({ userId: 'user-1' });
        expect(ctx.logger).toBeDefined();
        expect(res.json().data).toMatchObject({ method: 'pdfjs+gpt-vision', tabular: true, isScanned: false });
        expect(mocks.incrementDailyCap).toHaveBeenCalledTimes(1);
    });

    it('never ships the per-page layer or the page index list to the client', async () => {
        mocks.extractFromPDF.mockResolvedValue(layerResult());
        mocks.extractFromPdfViaVision.mockRejectedValue(new Error('OpenAI 503'));

        const res = await post();

        expect(res.json().data).not.toHaveProperty('pageTexts');
        expect(res.json().data).not.toHaveProperty('visionPages');
    });

    it('skips the Vision gate entirely when no page needs Vision', async () => {
        mocks.extractFromPDF.mockResolvedValue({ ...layerResult(), tabular: false, visionPages: [] });

        const res = await post();

        expect(res.statusCode).toBe(200);
        expect(res.json().data.method).toBe('pdfjs');
        expect(mocks.checkDailyCap).not.toHaveBeenCalled();
        expect(mocks.extractFromPdfViaVision).not.toHaveBeenCalled();
    });
});
