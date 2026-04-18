/**
 * Tests for KB file text extraction service.
 *
 * Covers PDF (text + scanned detection), Word (.docx), and image (GPT Vision)
 * extraction with safety limits: 5MB file size, 5-page PDF limit, 16K char cap.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocks ---

const mockPDFParse = {
    getText: vi.fn(),
    destroy: vi.fn().mockResolvedValue(undefined),
};

vi.mock('pdf-parse', () => ({
    PDFParse: vi.fn().mockImplementation(() => mockPDFParse),
}));

const mockExtractRawText = vi.fn();
vi.mock('mammoth', () => ({
    default: { extractRawText: mockExtractRawText },
    extractRawText: mockExtractRawText,
}));

const mockOpenAICreate = vi.fn();
vi.mock('openai', () => ({
    default: vi.fn().mockImplementation(() => ({
        chat: { completions: { create: mockOpenAICreate } },
    })),
}));

vi.mock('../../../src/config', () => ({
    config: { openai: { apiKey: 'sk-test-key' } },
}));

// --- Import after mocks ---

import {
    extractFromPDF,
    extractFromWord,
    extractFromImage,
    extractFromSpreadsheet,
    MAX_FILE_SIZE_BYTES,
    MAX_PDF_PAGES,
    MAX_OUTPUT_CHARS,
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
        expect(MAX_PDF_PAGES).toBe(5);
        expect(MAX_OUTPUT_CHARS).toBe(16_000);
    });

    // --- PDF extraction ---

    describe('extractFromPDF', () => {
        it('extracts text from a text-based PDF', async () => {
            mockPDFParse.getText.mockResolvedValue({
                text: 'Menu: Burger - 25 SAR, Pizza - 30 SAR, Pasta - 35 SAR, Salad - 20 SAR, Drinks from 10 SAR',
                total: 1,
            });

            const result = await extractFromPDF(Buffer.from('fake-pdf'));

            expect(result.method).toBe('pdf-parse');
            expect(result.isScanned).toBe(false);
            expect(result.text).toContain('Burger');
            expect(result.truncated).toBe(false);
        });

        it('limits PDF to first 5 pages', async () => {
            mockPDFParse.getText.mockResolvedValue({
                text: 'Page 1 content',
                total: 12,
            });

            const result = await extractFromPDF(Buffer.from('fake-pdf'));

            // Verify getText was called with { first: 5 }
            expect(mockPDFParse.getText).toHaveBeenCalledWith({ first: MAX_PDF_PAGES });
            expect(result.pagesTruncated).toBe(true);
        });

        it('does not flag pagesTruncated for small PDFs', async () => {
            mockPDFParse.getText.mockResolvedValue({
                text: 'Short PDF content',
                total: 2,
            });

            const result = await extractFromPDF(Buffer.from('fake-pdf'));

            expect(result.pagesTruncated).toBe(false);
        });

        it('detects scanned PDFs (text < 50 chars)', async () => {
            mockPDFParse.getText.mockResolvedValue({
                text: 'abc',
                total: 1,
            });

            const result = await extractFromPDF(Buffer.from('fake-pdf'));

            expect(result.isScanned).toBe(true);
            expect(result.text).toBe('abc');
        });

        it('detects scanned PDFs with empty text', async () => {
            mockPDFParse.getText.mockResolvedValue({
                text: '',
                total: 1,
            });

            const result = await extractFromPDF(Buffer.from('fake-pdf'));

            expect(result.isScanned).toBe(true);
            expect(result.text).toBe('');
        });

        it('escalates to Vision when Arabic table-like output is detected', async () => {
            // Mirrors the broken pdf-parse output from the user's course schedule
            const garbled = [
                'الكورس\tالأيام\tالوقت\tالتاريخ\tالمبلغ',
                'السبت\t--\tالأربعاء\t3--4\t25/4/2026',
                'الأحد\t--\tالثلاثاء\t9--10\t28/4/2026',
                'الخميس فقط\t2--4\t30/4/2026',
                'إنكليزي متوسط 1\tالأحد--الثلاثاء\t9--10\t29/4/2026\t35,000',
            ].join('\n');
            mockPDFParse.getText.mockResolvedValue({ text: garbled, total: 1 });

            const result = await extractFromPDF(Buffer.from('fake-pdf'));

            expect(result.isScanned).toBe(true);
        });

        it('does not escalate clean Arabic prose', async () => {
            // Long Arabic paragraph — no tabular structure, should stay on pdf-parse
            const prose = 'نحن شركة متخصصة في بيع المنتجات الإلكترونية. نعمل منذ عام 2015 ونخدم آلاف العملاء في جميع أنحاء المملكة. ساعات العمل من الأحد إلى الخميس من 9 صباحاً إلى 5 مساءً.';
            mockPDFParse.getText.mockResolvedValue({ text: prose, total: 1 });

            const result = await extractFromPDF(Buffer.from('fake-pdf'));

            expect(result.isScanned).toBe(false);
        });

        it('does not escalate English tables', async () => {
            // English tabular content — pdf-parse handles LTR tables well enough
            const englishTable = [
                'Item\tPrice\tStock\tCategory',
                'Laptop\t999\t12\tElectronics',
                'Phone\t499\t30\tElectronics',
                'Book\t25\t100\tMedia',
            ].join('\n');
            mockPDFParse.getText.mockResolvedValue({ text: englishTable, total: 1 });

            const result = await extractFromPDF(Buffer.from('fake-pdf'));

            expect(result.isScanned).toBe(false);
        });

        it('truncates text exceeding 16,000 chars', async () => {
            const longText = 'A'.repeat(20_000);
            mockPDFParse.getText.mockResolvedValue({
                text: longText,
                total: 3,
            });

            const result = await extractFromPDF(Buffer.from('fake-pdf'));

            expect(result.text.length).toBe(MAX_OUTPUT_CHARS);
            expect(result.truncated).toBe(true);
        });

        it('rejects files larger than 5MB', async () => {
            const bigBuffer = Buffer.alloc(6 * 1024 * 1024); // 6MB

            await expect(extractFromPDF(bigBuffer)).rejects.toThrow('exceeds 5MB limit');
        });

        it('calls destroy on the parser', async () => {
            mockPDFParse.getText.mockResolvedValue({ text: 'text', total: 1 });

            await extractFromPDF(Buffer.from('fake-pdf'));

            expect(mockPDFParse.destroy).toHaveBeenCalled();
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
        it('extracts text from an image using GPT-4o-mini', async () => {
            mockOpenAICreate.mockResolvedValue({
                choices: [{ message: { content: 'Price List:\nItem A - 100 SAR' } }],
            });

            const result = await extractFromImage(Buffer.from('fake-image'), 'image/jpeg');

            expect(result.method).toBe('gpt-vision');
            expect(result.text).toContain('Price List');
            // Verify gpt-4o-mini model is used
            expect(mockOpenAICreate).toHaveBeenCalledWith(
                expect.objectContaining({ model: 'gpt-4o-mini' }),
            );
        });

        it('sends image as base64 data URL', async () => {
            mockOpenAICreate.mockResolvedValue({
                choices: [{ message: { content: 'text' } }],
            });

            await extractFromImage(Buffer.from('test'), 'image/png');

            const messages = mockOpenAICreate.mock.calls[0][0].messages;
            const imageContent = messages[0].content.find((c: { type: string }) => c.type === 'image_url');
            expect(imageContent.image_url.url).toMatch(/^data:image\/png;base64,/);
        });

        it('truncates text exceeding 16,000 chars', async () => {
            mockOpenAICreate.mockResolvedValue({
                choices: [{ message: { content: 'C'.repeat(20_000) } }],
            });

            const result = await extractFromImage(Buffer.from('fake-image'), 'image/jpeg');

            expect(result.text.length).toBe(MAX_OUTPUT_CHARS);
            expect(result.truncated).toBe(true);
        });

        it('handles empty GPT response', async () => {
            mockOpenAICreate.mockResolvedValue({
                choices: [{ message: { content: '' } }],
            });

            const result = await extractFromImage(Buffer.from('fake-image'), 'image/jpeg');

            expect(result.text).toBe('');
        });

        it('rejects files larger than 5MB', async () => {
            const bigBuffer = Buffer.alloc(6 * 1024 * 1024);

            await expect(extractFromImage(bigBuffer, 'image/jpeg')).rejects.toThrow('exceeds 5MB limit');
        });

        it('throws when OpenAI API key is not configured', async () => {
            // Temporarily override config
            const { config } = await import('../../../src/config');
            const originalKey = config.openai?.apiKey;
            if (config.openai) config.openai.apiKey = '';

            await expect(extractFromImage(Buffer.from('test'), 'image/jpeg'))
                .rejects.toThrow('OpenAI API key not configured');

            // Restore
            if (config.openai) config.openai.apiKey = originalKey || 'sk-test-key';
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
});
