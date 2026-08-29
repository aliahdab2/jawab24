/**
 * Tests for KB file text extraction service.
 *
 * Covers PDF (text + scanned detection), Word (.docx), and image (GPT Vision)
 * extraction with safety limits: 5MB file size, 5-page PDF limit, 16K char cap.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocks ---

// pdfjs-dist: mock a document that yields the configured text per page
// (`mockPdfjsText(pageNumber)`, 1-based). Each line becomes one item with
// hasEOL=true, mirroring how pdfjs emits natural line breaks.
const mockPdfjsText = vi.fn<(page: number) => string>(() => '');
const mockPdfjsPages = vi.fn<() => number>(() => 1);
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
    getDocument: vi.fn(() => ({
        promise: Promise.resolve({
            numPages: mockPdfjsPages(),
            getPage: vi.fn(async (page: number) => ({
                getTextContent: vi.fn(async () => ({
                    items: mockPdfjsText(page)
                        .split('\n')
                        .map((line, idx, arr) => ({ str: line, hasEOL: idx < arr.length - 1 })),
                })),
                cleanup: vi.fn(),
            })),
            destroy: vi.fn().mockResolvedValue(undefined),
        }),
    })),
}));

const mockExtractRawText = vi.fn();
vi.mock('mammoth', () => ({
    default: { extractRawText: mockExtractRawText },
    extractRawText: mockExtractRawText,
}));

// The shared factory carries the FULL surface makeTrackedOpenAI binds at
// construction (chat/embeddings/images) — see helpers/openaiSdkMock.ts.
// vi.hoisted: the mock factory dereferences the spy the moment 'openai' is
// first imported, which is before plain module-level consts initialize.
const { mockOpenAICreate } = vi.hoisted(() => ({ mockOpenAICreate: vi.fn() }));
vi.mock('openai', async () => {
    const { makeOpenAiSdkMock } = await import('../../helpers/openaiSdkMock');
    return makeOpenAiSdkMock({ chatCreate: mockOpenAICreate }).module;
});

// pdf-to-img: a doc with `length`, `getPage(n)` (1-based) and `destroy()`;
// mock a tiny 2-page doc by default.
const mockPdfPages = vi.fn<() => Buffer[]>(() => [Buffer.from('png-1'), Buffer.from('png-2')]);
const mockPdfToImgDestroy = vi.fn(async () => undefined);
vi.mock('pdf-to-img', () => ({
    pdf: vi.fn(async () => {
        const pages = mockPdfPages();
        return {
            length: pages.length,
            getPage: async (n: number) => {
                const png = pages[n - 1];
                if (!png) throw new Error(`Invalid page request: ${n}`);
                return png;
            },
            destroy: mockPdfToImgDestroy,
        };
    }),
}));

vi.mock('../../../src/config', () => ({
    config: {
        openai: { apiKey: 'sk-test-key' },
        redis: { host: 'localhost', port: 6379, password: '' },
    },
}));

// Stub redis client used inside aiUsageLog (only touched on log-failure paths).
vi.mock('../../../src/lib/redis', () => ({
    redis: { incr: vi.fn().mockResolvedValue(1) },
}));

// --- Import after mocks ---

import {
    extractFromPDF,
    extractFromWord,
    extractFromImage,
    extractFromPdfViaVision,
    extractFromSpreadsheet,
    looksTabular,
    sniffMimeType,
    bufferMatchesMime,
    MAX_FILE_SIZE_BYTES,
    MAX_PDF_PAGES,
    MAX_PDF_VISION_PAGES,
    MAX_OUTPUT_CHARS,
    VISION_MODEL,
} from '../../../src/services/kb/file-extractor';
import ExcelJS from 'exceljs';

/** Build a real .xlsx buffer the same way a browser upload would. */
async function buildXlsx(
    build: (wb: ExcelJS.Workbook) => void,
): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    build(wb);
    const arr = await wb.xlsx.writeBuffer();
    return Buffer.from(arr as ArrayBuffer);
}

describe('KB File Extractor', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // --- Constants ---

    it('exports correct limits', () => {
        expect(MAX_FILE_SIZE_BYTES).toBe(5 * 1024 * 1024); // 5MB
        expect(MAX_PDF_PAGES).toBe(20);
        expect(MAX_PDF_VISION_PAGES).toBe(10);
        expect(MAX_OUTPUT_CHARS).toBe(16_000);
    });

    it('uses the same vision model as the rest of the platform, not the retired gpt-4o-mini', () => {
        // gpt-4o-mini guesses Arabic words from their shapes. The merchant
        // manual it OCR'd on 2026-08-29 came back with «الكروت» → «الكُتُب»
        // and «لا يحتاج العميل» → «يحتاج العمل» — inverted meaning, served to
        // customers. Every other vision caller had already moved on.
        expect(VISION_MODEL).toBe('gpt-4.1-mini');
    });

    // --- PDF extraction ---

    describe('extractFromPDF', () => {
        /** Same text on every page, or one entry per page. */
        const setPdf = (text: string | string[], pages = 1) => {
            if (Array.isArray(text)) {
                mockPdfjsText.mockImplementation((page) => text[page - 1] ?? '');
                mockPdfjsPages.mockReturnValue(text.length);
            } else {
                mockPdfjsText.mockReturnValue(text);
                mockPdfjsPages.mockReturnValue(pages);
            }
        };

        // Clears the scanned threshold on its own; carries no table.
        const PROSE_PAGE = 'نحن شركة متخصصة في بيع المنتجات الإلكترونية ونخدم آلاف العملاء في جميع أنحاء المملكة منذ عام 2015.';
        const TABLE_PAGE = [
            'الرقم | الاسم | العملة | الطريقة',
            'كشف عام\t20 دقيقة\t150',
            'تنظيف أسنان\t45 دقيقة\t300',
            'حشوة تجميلية\t60 دقيقة\t450',
        ].join('\n');

        it('decides per PAGE which pages need Vision: one table on page 5 of 7 flags page 5 only', async () => {
            // The shape of the real 2026-08-29 manual: six prose pages and one
            // payment-accounts table. The first fix decided per document and
            // sent all seven pages through Vision for that one table.
            setPdf([PROSE_PAGE, PROSE_PAGE, PROSE_PAGE, PROSE_PAGE, TABLE_PAGE, PROSE_PAGE, PROSE_PAGE]);

            const result = await extractFromPDF(Buffer.from('fake-pdf'));

            expect(result.isScanned).toBe(false);
            expect(result.tabular).toBe(true);
            expect(result.visionPages).toEqual([4]);
            expect(result.pagesRead).toBe(7);
            // The layer of every page is returned, the table page included.
            expect(result.pageTexts).toHaveLength(7);
            expect(result.text).toContain('حشوة تجميلية');
        });

        it('sends a page with no usable layer of its own to Vision (a scanner watermark inside a text file)', async () => {
            // Scanner apps stamp a short text layer on every scanned page. Per
            // document that clears the 50-char threshold; per page it does not.
            setPdf([PROSE_PAGE, 'Scanned with CamScanner', PROSE_PAGE]);

            const result = await extractFromPDF(Buffer.from('fake-pdf'));

            expect(result.isScanned).toBe(false);
            expect(result.tabular).toBe(false);
            expect(result.visionPages).toEqual([1]);
        });

        it('treats a file whose every page is watermark-only as all-Vision, not as read', async () => {
            // Three pages × 23 chars = 69 chars: the OLD document-level rule
            // called this "text present" and handed the merchant the watermarks.
            setPdf(['Scanned with CamScanner', 'Scanned with CamScanner', 'Scanned with CamScanner']);

            const result = await extractFromPDF(Buffer.from('fake-pdf'));

            expect(result.isScanned).toBe(false);
            expect(result.visionPages).toEqual([0, 1, 2]);
        });

        it('lists no Vision pages for a document every page of which reads cleanly', async () => {
            setPdf([PROSE_PAGE, PROSE_PAGE, PROSE_PAGE]);

            const result = await extractFromPDF(Buffer.from('fake-pdf'));

            expect(result.visionPages).toEqual([]);
            expect(result.tabular).toBe(false);
        });

        it('extracts text from a text-based PDF', async () => {
            setPdf('Menu: Burger - 25 SAR, Pizza - 30 SAR, Pasta - 35 SAR, Salad - 20 SAR, Drinks from 10 SAR');

            const result = await extractFromPDF(Buffer.from('fake-pdf'));

            expect(result.method).toBe('pdfjs');
            expect(result.isScanned).toBe(false);
            expect(result.tabular).toBe(false);
            expect(result.text).toContain('Burger');
            expect(result.truncated).toBe(false);
        });

        it('reads up to MAX_PDF_PAGES pages and reports what it skipped', async () => {
            setPdf('Page content long enough to clear the scanned threshold easily', 25);

            const result = await extractFromPDF(Buffer.from('fake-pdf'));

            expect(result.pagesRead).toBe(MAX_PDF_PAGES);
            expect(result.pagesTotal).toBe(25);
            expect(result.pagesTruncated).toBe(true);
        });

        it('reads a 7-page document in full (the old 5-page cap silently dropped its last two pages)', async () => {
            setPdf('Page content long enough to clear the scanned threshold easily', 7);

            const result = await extractFromPDF(Buffer.from('fake-pdf'));

            expect(result.pagesRead).toBe(7);
            expect(result.pagesTotal).toBe(7);
            expect(result.pagesTruncated).toBe(false);
        });

        it('returns one text-layer entry per page read, aligned by index', async () => {
            setPdf('Page content long enough to clear the scanned threshold easily', 3);

            const result = await extractFromPDF(Buffer.from('fake-pdf'));

            expect(result.pageTexts).toHaveLength(3);
        });

        it('detects scanned PDFs (text < 50 chars)', async () => {
            setPdf('abc');

            const result = await extractFromPDF(Buffer.from('fake-pdf'));

            expect(result.isScanned).toBe(true);
            expect(result.text).toBe('abc');
        });

        it('detects scanned PDFs with empty text', async () => {
            setPdf('');

            const result = await extractFromPDF(Buffer.from('fake-pdf'));

            expect(result.isScanned).toBe(true);
            expect(result.text).toBe('');
        });

        it('flags a space-separated Arabic schedule as tabular but KEEPS its text layer', async () => {
            // Real pdfjs output shape for a timetable: rows are space-separated
            // with times/dates and no tabs. The layout needs Vision; the words do not.
            const spaceTabular = [
                'الدورة الأيام الوقت التاريخ المبلغ',
                'الأحد--الثلاثاء 6--7 30/4/2026',
                'الأحد--الثلاثاء 4--5 30/4/2026',
                'السبت--الخميس 7--8 18/4/2026',
                'الخميس فقط 2--4 30/4/2026 50,000',
            ].join('\n');
            setPdf(spaceTabular);

            const result = await extractFromPDF(Buffer.from('fake-pdf'));

            expect(result.isScanned).toBe(false);
            expect(result.tabular).toBe(true);
            expect(result.text).toContain('50,000');
            expect(result.pageTexts?.[0]).toContain('الخميس فقط');
        });

        it('flags a tab-delimited Arabic price table (clinic fees) as tabular', async () => {
            const clinicFees = [
                'الخدمة\tالمدة\tالسعر',
                'كشف عام\t20 دقيقة\t150',
                'تنظيف أسنان\t45 دقيقة\t300',
                'حشوة تجميلية\t60 دقيقة\t450',
                'تبييض\t90 دقيقة\t1200',
            ].join('\n');
            setPdf(clinicFees);

            const result = await extractFromPDF(Buffer.from('fake-pdf'));

            expect(result.isScanned).toBe(false);
            expect(result.tabular).toBe(true);
        });

        it('does NOT flag a numbered Arabic reference document with prices in prose (the 2026-08-29 regression)', async () => {
            // Shape of the software vendor's manual that the old heuristic sent
            // to OCR at a 49% "row" ratio: numbered headings, bullet steps, a
            // subscription paragraph with one or two numbers per sentence, a
            // download URL. Not one of these lines is a table row.
            const manual = [
                'زد نت Z NET',
                'قاعدة المعرفة الشاملة لنظام «جواب» للرد التلقائي على استفسارات العملاء',
                'إصدار أغسطس 2026',
                '1 . ما هو Z NET ؟',
                'Z NET هو تطبيق أندرويد ذكي مخصص لأصحاب ومزودي شبكات الإنترنت لأتمتة بيع وتوزيع كروت الشبكة.',
                'التطبيق يكون على هاتف صاحب الشبكة، ولا يحتاج العميل إلى تثبيت تطبيق.',
                '2 . دورة البيع الآلية',
                '1 ) تصل رسالة إشعار التحويل إلى هاتف صاحب الشبكة.',
                '2 ) يحلل النظام الرسالة ويستخرج المبلغ ورقم المشترك والمرجع حسب القالب.',
                '3 ) يسجل قيد إيداع للعميل ويحدث رصيده.',
                '4 ) يبحث عن كرت مناسب في المخزون ويحجزه لمنع البيع المزدوج.',
                '11 . التجزئة والاشتراكات',
                'الفترة التجريبية المجانية: شهر كامل.',
                'شهر: 2,000 ريال يمني ويعادل 15 ريال سعودي.',
                '3 أشهر: 6,000 ريال يمني ويعادل 36 ريال سعودي.',
                'سنة: 15,000 ريال يمني ويعادل 107 ريال سعودي.',
                'رابط التحميل والتحديث الرسمي المعتمد:',
                'https://www.mediafire.com/file/myb7uuy0jvs2a3n/ZNet-1.0.6-180826.apk/file',
                'رقم خدمة العملاء الرسمي: 785575899',
            ].join('\n');
            setPdf(manual, 7);

            const result = await extractFromPDF(Buffer.from('fake-pdf'));

            expect(result.isScanned).toBe(false);
            expect(result.tabular).toBe(false);
            expect(result.method).toBe('pdfjs');
            // The exact text layer, untouched — this is what used to be thrown away.
            expect(result.text).toContain('ولا يحتاج العميل إلى تثبيت تطبيق');
            expect(result.text).toContain('كروت الشبكة');
        });

        it('does not flag an Arabic restaurant menu written as prose', async () => {
            const menu = [
                'قائمة الطعام',
                'المشاوي: كباب حلبي بالفستق 45 ريال، شيش طاووق 40 ريال، مشاوي مشكلة للشخصين 120 ريال.',
                'المقبلات: حمص بالطحينة 15 ريال، متبل 15 ريال، تبولة 18 ريال، فتوش 18 ريال.',
                'المشروبات: عصير طازج 12 ريال، شاي بالنعناع 6 ريال، قهوة عربية للدلة 25 ريال.',
                'التوصيل داخل المدينة 10 ريال ويستغرق من 30 إلى 45 دقيقة.',
            ].join('\n');
            setPdf(menu);

            const result = await extractFromPDF(Buffer.from('fake-pdf'));

            expect(result.tabular).toBe(false);
        });

        it('does not flag clean Arabic prose', async () => {
            const prose = 'نحن شركة متخصصة في بيع المنتجات الإلكترونية. نعمل منذ عام 2015 ونخدم آلاف العملاء في جميع أنحاء المملكة. ساعات العمل من الأحد إلى الخميس من 9 صباحاً إلى 5 مساءً.';
            setPdf(prose);

            const result = await extractFromPDF(Buffer.from('fake-pdf'));

            expect(result.isScanned).toBe(false);
            expect(result.tabular).toBe(false);
        });

        it('does not flag English tables (LTR column order survives pdfjs; Vision is plan-gated)', async () => {
            const englishTable = [
                'Item\tPrice\tStock\tCategory',
                'Laptop\t999\t12\tElectronics',
                'Phone\t499\t30\tElectronics',
                'Book\t25\t100\tMedia',
            ].join('\n');
            setPdf(englishTable);

            const result = await extractFromPDF(Buffer.from('fake-pdf'));

            expect(result.isScanned).toBe(false);
            expect(result.tabular).toBe(false);
        });

        it('truncates text exceeding 16,000 chars', async () => {
            setPdf('A'.repeat(20_000), 3);

            const result = await extractFromPDF(Buffer.from('fake-pdf'));

            expect(result.text.length).toBe(MAX_OUTPUT_CHARS);
            expect(result.truncated).toBe(true);
        });

        it('rejects files larger than 5MB', async () => {
            const bigBuffer = Buffer.alloc(6 * 1024 * 1024);

            await expect(extractFromPDF(bigBuffer)).rejects.toThrow('exceeds 5MB limit');
        });
    });

    // --- Word extraction ---

    describe('extractFromWord', () => {
        it('extracts text from a Word document', async () => {
            mockExtractRawText.mockResolvedValue({
                value: 'Services:\n- Haircut: 50 SAR\n- Coloring: 150 SAR',
                messages: [],
            });

            const result = await extractFromWord(Buffer.from('fake-docx'));

            expect(result.method).toBe('mammoth');
            expect(result.text).toContain('Haircut');
            expect(result.truncated).toBe(false);
        });

        it('truncates text exceeding 16,000 chars', async () => {
            mockExtractRawText.mockResolvedValue({
                value: 'B'.repeat(20_000),
                messages: [],
            });

            const result = await extractFromWord(Buffer.from('fake-docx'));

            expect(result.text.length).toBe(MAX_OUTPUT_CHARS);
            expect(result.truncated).toBe(true);
        });

        it('handles empty Word document', async () => {
            mockExtractRawText.mockResolvedValue({
                value: '',
                messages: [],
            });

            const result = await extractFromWord(Buffer.from('fake-docx'));

            expect(result.text).toBe('');
            expect(result.truncated).toBe(false);
        });

        it('rejects files larger than 5MB', async () => {
            const bigBuffer = Buffer.alloc(6 * 1024 * 1024);

            await expect(extractFromWord(bigBuffer)).rejects.toThrow('exceeds 5MB limit');
        });
    });

    // --- Image extraction (GPT Vision) ---

    describe('extractFromImage', () => {
        it('extracts text from an image using the platform vision model', async () => {
            mockOpenAICreate.mockResolvedValue({
                choices: [{ message: { content: 'Price List:\nItem A - 100 SAR' } }],
            });

            const result = await extractFromImage(Buffer.from('fake-image'), 'image/jpeg', { userId: 'test-user' });

            expect(result.method).toBe('gpt-vision');
            expect(result.text).toContain('Price List');
            expect(mockOpenAICreate).toHaveBeenCalledWith(
                expect.objectContaining({ model: VISION_MODEL }),
            );
        });

        it('sends image as base64 data URL', async () => {
            mockOpenAICreate.mockResolvedValue({
                choices: [{ message: { content: 'text' } }],
            });

            await extractFromImage(Buffer.from('test'), 'image/png', { userId: 'test-user' });

            const messages = mockOpenAICreate.mock.calls[0][0].messages;
            const imageContent = messages[0].content.find((c: { type: string }) => c.type === 'image_url');
            expect(imageContent.image_url.url).toMatch(/^data:image\/png;base64,/);
        });

        it('truncates text exceeding 16,000 chars', async () => {
            mockOpenAICreate.mockResolvedValue({
                choices: [{ message: { content: 'C'.repeat(20_000) } }],
            });

            const result = await extractFromImage(Buffer.from('fake-image'), 'image/jpeg', { userId: 'test-user' });

            expect(result.text.length).toBe(MAX_OUTPUT_CHARS);
            expect(result.truncated).toBe(true);
        });

        it('handles empty GPT response', async () => {
            mockOpenAICreate.mockResolvedValue({
                choices: [{ message: { content: '' } }],
            });

            const result = await extractFromImage(Buffer.from('fake-image'), 'image/jpeg', { userId: 'test-user' });

            expect(result.text).toBe('');
        });

        it('rejects files larger than 5MB', async () => {
            const bigBuffer = Buffer.alloc(6 * 1024 * 1024);

            await expect(extractFromImage(bigBuffer, 'image/jpeg', { userId: 'test-user' })).rejects.toThrow('exceeds 5MB limit');
        });

        it('throws when OpenAI API key is not configured', async () => {
            // Temporarily override config
            const { config } = await import('../../../src/config');
            const originalKey = config.openai?.apiKey;
            if (config.openai) config.openai.apiKey = '';

            await expect(extractFromImage(Buffer.from('test'), 'image/jpeg', { userId: 'test-user' }))
                .rejects.toThrow('OpenAI API key not configured');

            // Restore
            if (config.openai) config.openai.apiKey = originalKey || 'sk-test-key';
        });
    });

    // --- PDF → Vision extraction (rasterize then OCR) ---

    describe('extractFromPdfViaVision', () => {
        it('rasterizes pages and sends each to Vision, concatenating results', async () => {
            mockPdfPages.mockReturnValue([Buffer.from('png-1'), Buffer.from('png-2')]);
            mockOpenAICreate
                .mockResolvedValueOnce({ choices: [{ message: { content: 'Page 1: ICDL — 25,000 SAR' } }] })
                .mockResolvedValueOnce({ choices: [{ message: { content: 'Page 2: Photoshop — 50,000 SAR' } }] });

            const result = await extractFromPdfViaVision(Buffer.from('fake-pdf'), { userId: 'test-user' });

            expect(result.method).toBe('gpt-vision');
            expect(mockOpenAICreate).toHaveBeenCalledTimes(2);
            expect(result.text).toContain('ICDL');
            expect(result.text).toContain('Photoshop');
            // Pages must be separated (not concatenated back-to-back)
            expect(result.text).toMatch(/Page 1:[^]*\n\n[^]*Page 2:/);
        });

        it('caps rendering at MAX_PDF_VISION_PAGES and reports the skip', async () => {
            mockPdfPages.mockReturnValue(
                Array.from({ length: MAX_PDF_VISION_PAGES + 4 }, (_, i) => Buffer.from(`png-${i + 1}`)),
            );
            mockOpenAICreate.mockResolvedValue({ choices: [{ message: { content: 'page' } }] });

            const result = await extractFromPdfViaVision(Buffer.from('fake-pdf'), { userId: 'test-user' });

            expect(mockOpenAICreate).toHaveBeenCalledTimes(MAX_PDF_VISION_PAGES);
            expect(result.pagesRead).toBe(MAX_PDF_VISION_PAGES);
            expect(result.pagesTotal).toBe(MAX_PDF_VISION_PAGES + 4);
            expect(result.pagesTruncated).toBe(true);
        });

        it('passes each image to Vision as a PNG data URL, using the platform vision model', async () => {
            mockPdfPages.mockReturnValue([Buffer.from('png-bytes')]);
            mockOpenAICreate.mockResolvedValue({ choices: [{ message: { content: 'ok' } }] });

            await extractFromPdfViaVision(Buffer.from('fake-pdf'), { userId: 'test-user' });

            const call = mockOpenAICreate.mock.calls[0][0];
            expect(call.model).toBe(VISION_MODEL);
            const img = call.messages[0].content.find((c: { type: string }) => c.type === 'image_url');
            expect(img.image_url.url).toMatch(/^data:image\/png;base64,/);
            expect(img.image_url.detail).toBe('high');
        });

        it('sends no text layer for a scanned PDF (there is none to send)', async () => {
            mockPdfPages.mockReturnValue([Buffer.from('png-bytes')]);
            mockOpenAICreate.mockResolvedValue({ choices: [{ message: { content: 'ok' } }] });

            await extractFromPdfViaVision(Buffer.from('fake-pdf'), { userId: 'test-user' });

            const text = mockOpenAICreate.mock.calls[0][0].messages[0].content
                .find((c: { type: string }) => c.type === 'text').text;
            expect(text).not.toContain('<text_layer>');
        });

        // Layers long enough to be worth anchoring on (≥ the scanned threshold).
        const CLINIC_LAYER = 'الخدمة\tالمدة\tالسعر\nكشف عام\t20 دقيقة\t150\nتنظيف أسنان\t45 دقيقة\t300\nحشوة تجميلية\t60 دقيقة\t450';
        const WHITENING_LAYER = 'الخدمة\tالمدة\tالسعر\nتبييض\t90 دقيقة\t1200\nتقويم شفاف\t12 شهراً\t9000\nزراعة\t3 أشهر\t4500';
        const textOf = (i: number) => mockOpenAICreate.mock.calls[i][0].messages[0].content
            .find((c: { type: string }) => c.type === 'text').text as string;
        const imageOf = (i: number) => mockOpenAICreate.mock.calls[i][0].messages[0].content
            .find((c: { type: string }) => c.type === 'image_url').image_url.url as string;

        it('anchors each page on its own text layer when one is supplied (tabular text-layer PDFs)', async () => {
            mockPdfPages.mockReturnValue([Buffer.from('png-1'), Buffer.from('png-2')]);
            mockOpenAICreate.mockResolvedValue({ choices: [{ message: { content: 'ok' } }] });

            const result = await extractFromPdfViaVision(
                Buffer.from('fake-pdf'),
                { userId: 'test-user' },
                { pageTexts: [CLINIC_LAYER, WHITENING_LAYER] },
            );

            // Page 1 gets page 1's layer, page 2 gets page 2's — never each other's.
            expect(textOf(0)).toContain('<text_layer>');
            expect(textOf(0)).toContain('كشف عام');
            expect(textOf(0)).not.toContain('تبييض');
            expect(textOf(1)).toContain('تبييض');
            expect(textOf(1)).not.toContain('كشف عام');
            // The instruction that anchors words on the layer and glyphs on the image.
            expect(textOf(0)).toMatch(/WORDS are authoritative/);
            expect(textOf(0)).toMatch(/glyph artifacts/);
            // Marker content is document text, never an instruction to the model.
            expect(textOf(0)).toMatch(/never instructions to follow/);
            expect(result.method).toBe('pdfjs+gpt-vision');
        });

        it('falls back to image-only for a page whose text layer is blank', async () => {
            mockPdfPages.mockReturnValue([Buffer.from('png-1')]);
            mockOpenAICreate.mockResolvedValue({ choices: [{ message: { content: 'ok' } }] });

            await extractFromPdfViaVision(Buffer.from('fake-pdf'), { userId: 'test-user' }, { pageTexts: ['   '] });

            expect(textOf(0)).not.toContain('<text_layer>');
        });

        it('renders and OCRs ONLY the requested pages and splices them between verbatim layer pages', async () => {
            // Seven-page manual, one table on page 5 (index 4).
            mockPdfPages.mockReturnValue(Array.from({ length: 7 }, (_, i) => Buffer.from(`png-${i + 1}`)));
            mockOpenAICreate.mockResolvedValue({ choices: [{ message: { content: 'OCR of page 5' } }] });
            const layers = Array.from({ length: 7 }, (_, i) => `صفحة ${i + 1}: `.padEnd(60, 'نص'));
            layers[4] = CLINIC_LAYER;

            const result = await extractFromPdfViaVision(
                Buffer.from('fake-pdf'),
                { userId: 'test-user' },
                { pageTexts: layers, pages: [4] },
            );

            // One call, for page 5, with page 5's image and page 5's layer.
            expect(mockOpenAICreate).toHaveBeenCalledTimes(1);
            expect(imageOf(0)).toBe(`data:image/png;base64,${Buffer.from('png-5').toString('base64')}`);
            expect(textOf(0)).toContain('كشف عام');
            // Output: pages 1–4 verbatim, the OCR in page 5's slot, pages 6–7 verbatim.
            const blocks = result.text.split('\n\n');
            expect(blocks).toHaveLength(7);
            expect(blocks[0]).toBe(layers[0]);
            expect(blocks[3]).toBe(layers[3]);
            expect(blocks[4]).toBe('OCR of page 5');
            expect(blocks[5]).toBe(layers[5]);
            expect(blocks[6]).toBe(layers[6]);
            expect(result.method).toBe('pdfjs+gpt-vision');
            expect(result.visionPages).toEqual([4]);
            // The text pass read all seven; nothing was skipped.
            expect(result.pagesRead).toBe(7);
            expect(result.pagesTotal).toBe(7);
            expect(result.pagesTruncated).toBe(false);
        });

        it('OCRs image-only a requested page whose own layer is below the scanned threshold, anchored for one above it', async () => {
            mockPdfPages.mockReturnValue([Buffer.from('png-1'), Buffer.from('png-2'), Buffer.from('png-3')]);
            mockOpenAICreate.mockResolvedValue({ choices: [{ message: { content: 'ocr' } }] });

            await extractFromPdfViaVision(
                Buffer.from('fake-pdf'),
                { userId: 'test-user' },
                { pageTexts: ['نص طويل بما يكفي ليتجاوز حد المسح الضوئي في هذا الاختبار بلا جدول', 'Scanned with CamScanner', CLINIC_LAYER], pages: [1, 2] },
            );

            expect(mockOpenAICreate).toHaveBeenCalledTimes(2);
            expect(textOf(0)).not.toContain('<text_layer>');   // the watermark page: image only
            expect(textOf(1)).toContain('<text_layer>');       // the table page: anchored
        });

        it('caps per-page Vision at MAX_PDF_VISION_PAGES and keeps the layer for the rest', async () => {
            const n = MAX_PDF_VISION_PAGES + 3;
            mockPdfPages.mockReturnValue(Array.from({ length: n }, (_, i) => Buffer.from(`png-${i + 1}`)));
            mockOpenAICreate.mockResolvedValue({ choices: [{ message: { content: 'ocr' } }] });
            const layers = Array.from({ length: n }, () => CLINIC_LAYER);

            const result = await extractFromPdfViaVision(
                Buffer.from('fake-pdf'),
                { userId: 'test-user' },
                { pageTexts: layers, pages: layers.map((_, i) => i) },
            );

            expect(mockOpenAICreate).toHaveBeenCalledTimes(MAX_PDF_VISION_PAGES);
            const blocks = result.text.split('\n\n');
            expect(blocks).toHaveLength(n);
            expect(blocks[MAX_PDF_VISION_PAGES - 1]).toBe('ocr');
            expect(blocks[MAX_PDF_VISION_PAGES]).toBe(CLINIC_LAYER);
            // No page was skipped — the uncapped ones kept their layer.
            expect(result.pagesRead).toBe(n);
            expect(result.pagesTruncated).toBe(false);
        });

        it('keeps the layer for a page whose Vision reply came back empty', async () => {
            mockPdfPages.mockReturnValue([Buffer.from('png-1')]);
            mockOpenAICreate.mockResolvedValue({ choices: [{ message: { content: '' } }] });

            const result = await extractFromPdfViaVision(
                Buffer.from('fake-pdf'),
                { userId: 'test-user' },
                { pageTexts: [CLINIC_LAYER], pages: [0] },
            );

            expect(result.text).toBe(CLINIC_LAYER);
        });

        it('reports a page that hit max_tokens as truncated and logs it, instead of a silently shortened page', async () => {
            mockPdfPages.mockReturnValue([Buffer.from('png-1')]);
            mockOpenAICreate.mockResolvedValue({ choices: [{ message: { content: 'half a page' }, finish_reason: 'length' }] });
            const logger = { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() };

            const result = await extractFromPdfViaVision(Buffer.from('fake-pdf'), { userId: 'test-user', logger });

            expect(result.truncated).toBe(true);
            expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/max_tokens/), expect.objectContaining({ page: 1 }));
        });

        it('releases the rendered document when done', async () => {
            mockPdfPages.mockReturnValue([Buffer.from('png-1')]);
            mockOpenAICreate.mockResolvedValue({ choices: [{ message: { content: 'ok' } }] });

            await extractFromPdfViaVision(Buffer.from('fake-pdf'), { userId: 'test-user' });

            expect(mockPdfToImgDestroy).toHaveBeenCalledTimes(1);
        });

        it('truncates concatenated text exceeding 16,000 chars', async () => {
            mockPdfPages.mockReturnValue([Buffer.from('p1'), Buffer.from('p2')]);
            mockOpenAICreate.mockResolvedValue({ choices: [{ message: { content: 'X'.repeat(10_000) } }] });

            const result = await extractFromPdfViaVision(Buffer.from('fake-pdf'), { userId: 'test-user' });

            expect(result.text.length).toBe(MAX_OUTPUT_CHARS);
            expect(result.truncated).toBe(true);
        });

        it('returns empty result when the PDF has no pages', async () => {
            mockPdfPages.mockReturnValue([]);

            const result = await extractFromPdfViaVision(Buffer.from('fake-pdf'), { userId: 'test-user' });

            expect(result.text).toBe('');
            expect(mockOpenAICreate).not.toHaveBeenCalled();
        });

        it('rejects files larger than 5MB before rendering', async () => {
            const bigBuffer = Buffer.alloc(6 * 1024 * 1024);

            await expect(extractFromPdfViaVision(bigBuffer, { userId: 'test-user' })).rejects.toThrow('exceeds 5MB limit');
        });

        it('throws when OpenAI API key is not configured', async () => {
            const { config } = await import('../../../src/config');
            const originalKey = config.openai?.apiKey;
            if (config.openai) config.openai.apiKey = '';

            await expect(extractFromPdfViaVision(Buffer.from('test'), { userId: 'test-user' }))
                .rejects.toThrow('OpenAI API key not configured');

            if (config.openai) config.openai.apiKey = originalKey || 'sk-test-key';
        });
    });

    // --- Table detection (shape-based, vertical-agnostic) ---

    describe('looksTabular', () => {
        it('does not treat a pipe-separated contact block of mostly words as a table', () => {
            // A bank-details block: one number among seven word tokens per line
            // is a sentence-shaped line, not a numeric-dense row.
            const bank = [
                'الرقم | الاسم | العملة',
                '3025729691 | عبد الرحمن جميل | ريال سعودي',
                '785576899 | عبد الرحمن جميل | ريال يمني',
            ].join('\n');
            expect(looksTabular(bank)).toBe(false);
        });

        it('is broken by a blank line (tables are contiguous)', () => {
            const rows = ['الأحد 6--7 30/4/2026', 'الاثنين 7--8 30/4/2026'];
            expect(looksTabular([...rows, '', ...rows].join('\n'))).toBe(false);
            expect(looksTabular([...rows, ...rows].join('\n'))).toBe(true);
        });

        it('treats a numeric-dense short line as a row regardless of vertical', () => {
            // Real-estate listing, sizes chart, delivery table — same shape.
            const sizes = ['المقاس الصدر الطول', 'S 90 65', 'M 96 68', 'L 102 71', 'XL 108 74'].join('\n');
            expect(looksTabular(sizes)).toBe(true);

            const delivery = ['المدينة السعر المدة', 'صنعاء 500 1-2', 'عدن 800 2-3', 'تعز 700 2-3'].join('\n');
            expect(looksTabular(delivery)).toBe(true);
        });

        it('does not count a sentence with a price or two as a row', () => {
            const prose = [
                'شهر: 2,000 ريال يمني ويعادل 15 ريال سعودي.',
                '3 أشهر: 6,000 ريال يمني ويعادل 36 ريال سعودي.',
                'سنة: 15,000 ريال يمني ويعادل 107 ريال سعودي.',
                'بعد تحويل قيمة الاشتراك يتم إرسال كود التفعيل خلال 10 دقائق.',
            ].join('\n');
            expect(looksTabular(prose)).toBe(false);
        });

        it('does not count gap-padded prose from a subsetted-font PDF as rows (the real Z net text layer)', () => {
            // Verbatim pdfjs output: unmapped ligature glyphs («لا», «لأ») come
            // out as stray Latin letters padded with 3+ spaces. Four consecutive
            // sentences, each with 2+ "gaps" — the old delimiter rule read this
            // as a table and the whole document went to OCR.
            const padded = [
                'ا حتى يرد أحد موظفي خدمة العملاء.   K   ل طلب من العميل الانتظار قلي   N   ي   السؤال غير مغطى أو احتاجت الحالة إلى فحص يدوي،',
                'ا من المخزون، ثم يرسل كود الكرت K   ب ا مناس K   ت يستقبل التطبيق رسائل التحويل المالي، يحلل بيانات الحوالة، يحدد العميل والمبلغ، يختار كر',
                '3 ث رصيده.   j   د يسجل قيد إيداع للعميل ويح   )',
                'للعميل برسالة SMS ا.   K ي تلقائ',
            ].join('\n');
            expect(looksTabular(padded)).toBe(false);
        });

        it('still flags a space-aligned table whose cells are short', () => {
            const aligned = [
                'الخدمة        المدة        السعر',
                'كشف عام       20 دقيقة     150',
                'تنظيف أسنان   45 دقيقة     300',
                'حشوة تجميلية  60 دقيقة     450',
            ].join('\n');
            expect(looksTabular(aligned)).toBe(true);
        });

        it('does not count numbered headings or steps as rows', () => {
            const steps = ['1 . الخطوة الأولى', '2 . الخطوة الثانية', '3 . الخطوة الثالثة', '4 . الخطوة الرابعة'].join('\n');
            expect(looksTabular(steps)).toBe(false);
        });

        it('does not treat tokens with letters as numeric (URLs, SKUs, versions)', () => {
            const skus = ['ZNet-1.0.6-180826.apk v1.0.6', 'iPhone15 A2846 v17.2', 'SKU-2291 B77 rev3', 'model X200 v2'].join('\n');
            expect(looksTabular('منتجاتنا:\n' + skus)).toBe(false);
        });

        it('accepts Arabic-Indic digits', () => {
            const rows = ['الأحد ٦--٧ ٣٠/٤/٢٠٢٦', 'الاثنين ٧--٨ ٣٠/٤/٢٠٢٦', 'الثلاثاء ٨--٩ ٣٠/٤/٢٠٢٦'].join('\n');
            expect(looksTabular(rows)).toBe(true);
        });
    });

    // --- Spreadsheet extraction (.xlsx) ---

    describe('extractFromSpreadsheet', () => {
        it('extracts tab-separated rows from a simple sheet', async () => {
            const buffer = await buildXlsx((wb) => {
                const sheet = wb.addWorksheet('Prices');
                sheet.addRow(['Item', 'Price']);
                sheet.addRow(['Burger', 25]);
                sheet.addRow(['Pizza', 30]);
            });

            const result = await extractFromSpreadsheet(buffer);

            expect(result.method).toBe('exceljs');
            expect(result.text).toBe('Item\tPrice\nBurger\t25\nPizza\t30');
        });

        it('expands merged cells into every spanned row (the PDF bug fix)', async () => {
            // Mirrors the real-world Arabic course schedule: one course name
            // merged across 3 rows with 3 different dates.
            const buffer = await buildXlsx((wb) => {
                const sheet = wb.addWorksheet('Courses');
                sheet.addRow(['Course', 'Date']);
                sheet.addRow(['إنكليزي مبتدئ', '25/4']);
                sheet.addRow([null, '28/4']);
                sheet.addRow([null, '30/4']);
                sheet.mergeCells('A2:A4');
            });

            const result = await extractFromSpreadsheet(buffer);

            // Every row must carry the merged course name — this is what
            // pdf-parse got wrong.
            const lines = result.text.split('\n');
            expect(lines).toHaveLength(4);
            expect(lines[1]).toBe('إنكليزي مبتدئ\t25/4');
            expect(lines[2]).toBe('إنكليزي مبتدئ\t28/4');
            expect(lines[3]).toBe('إنكليزي مبتدئ\t30/4');
        });

        it('separates multiple sheets with a sheet-name header', async () => {
            const buffer = await buildXlsx((wb) => {
                wb.addWorksheet('Menu').addRow(['Burger', 25]);
                wb.addWorksheet('Hours').addRow(['Mon-Fri', '9-17']);
            });

            const result = await extractFromSpreadsheet(buffer);

            expect(result.text).toContain('=== Menu ===');
            expect(result.text).toContain('=== Hours ===');
            expect(result.text).toContain('Burger\t25');
            expect(result.text).toContain('Mon-Fri\t9-17');
        });

        it('omits the sheet-name header when there is only one sheet', async () => {
            const buffer = await buildXlsx((wb) => {
                wb.addWorksheet('Only').addRow(['a', 'b']);
            });

            const result = await extractFromSpreadsheet(buffer);

            expect(result.text).not.toContain('===');
            expect(result.text).toBe('a\tb');
        });

        it('skips fully empty rows', async () => {
            const buffer = await buildXlsx((wb) => {
                const sheet = wb.addWorksheet('S');
                sheet.addRow(['one']);
                sheet.addRow([]); // empty
                sheet.addRow(['two']);
            });

            const result = await extractFromSpreadsheet(buffer);

            expect(result.text).toBe('one\ntwo');
        });

        it('truncates text exceeding 16,000 chars', async () => {
            const buffer = await buildXlsx((wb) => {
                const sheet = wb.addWorksheet('Big');
                for (let i = 0; i < 2000; i++) {
                    sheet.addRow(['X'.repeat(20)]);
                }
            });

            const result = await extractFromSpreadsheet(buffer);

            expect(result.text.length).toBe(MAX_OUTPUT_CHARS);
            expect(result.truncated).toBe(true);
        });

        it('rejects files larger than 5MB', async () => {
            const bigBuffer = Buffer.alloc(6 * 1024 * 1024);

            await expect(extractFromSpreadsheet(bigBuffer)).rejects.toThrow('exceeds 5MB limit');
        });
    });

    // --- Magic-byte sniffing ---

    describe('sniffMimeType', () => {
        it('detects JPEG from FF D8 FF header', () => {
            expect(sniffMimeType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]))).toBe('image/jpeg');
        });

        it('detects PNG from 89 50 4E 47 0D 0A 1A 0A header', () => {
            expect(sniffMimeType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]))).toBe('image/png');
        });

        it('detects WebP from RIFF....WEBP header', () => {
            const buf = Buffer.concat([
                Buffer.from('RIFF'),
                Buffer.from([0x10, 0x00, 0x00, 0x00]),
                Buffer.from('WEBP'),
                Buffer.from([0x00, 0x00]),
            ]);
            expect(sniffMimeType(buf)).toBe('image/webp');
        });

        it('detects PDF from %PDF- header', () => {
            expect(sniffMimeType(Buffer.from('%PDF-1.4\n'))).toBe('application/pdf');
        });

        it('detects Office ZIP container from 50 4B 03 04 header', () => {
            expect(sniffMimeType(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]))).toBe('application/zip');
        });

        it('detects legacy OLE .doc from D0 CF 11 E0 A1 B1 1A E1', () => {
            expect(sniffMimeType(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00]))).toBe(
                'application/x-ole-storage',
            );
        });

        it('returns null for unknown formats (e.g. HEIC renamed to jpg)', () => {
            // HEIC files start with `....ftypheic` — no JPEG/PNG/WebP magic.
            const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic')]);
            expect(sniffMimeType(heic)).toBeNull();
        });

        it('returns null for tiny buffers', () => {
            expect(sniffMimeType(Buffer.from([0xff]))).toBeNull();
        });
    });

    describe('bufferMatchesMime', () => {
        it('accepts matching image bytes and declared mime', () => {
            const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
            expect(bufferMatchesMime(jpeg, 'image/jpeg')).toBe(true);
        });

        it('rejects JPEG bytes declared as PNG', () => {
            const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
            expect(bufferMatchesMime(jpeg, 'image/png')).toBe(false);
        });

        it('rejects HEIC-like bytes declared as image/jpeg (the real Sentry incident)', () => {
            const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic')]);
            expect(bufferMatchesMime(heic, 'image/jpeg')).toBe(false);
        });

        it('accepts ZIP container for both docx and xlsx', () => {
            const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]);
            expect(
                bufferMatchesMime(zip, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
            ).toBe(true);
            expect(
                bufferMatchesMime(zip, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
            ).toBe(true);
        });

        it('accepts OLE compound doc for legacy application/msword', () => {
            const ole = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00]);
            expect(bufferMatchesMime(ole, 'application/msword')).toBe(true);
        });

        it('rejects when no magic bytes are detected', () => {
            expect(bufferMatchesMime(Buffer.from([0x00, 0x01, 0x02, 0x03]), 'image/jpeg')).toBe(false);
        });
    });
});
