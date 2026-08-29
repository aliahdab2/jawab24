import { config } from '../../config';
import { makeTrackedOpenAI } from '../openaiClient';
import type { AiPipeline } from '../../types/aiPipeline';

/** Caller context for cost attribution. Passed through from the kb-upload route. */
export interface VisionContext {
    userId: string;
    pageId?: string;
    /** Cost-attribution tag. Defaults to 'kb_file_extraction' (the KB upload
     *  flow); the catalog posts-scan passes 'catalog_extraction' so its vision
     *  spend lands in the same bucket as its extract call. */
    pipeline?: AiPipeline;
}

const SCANNED_PDF_THRESHOLD = 50; // chars — below this, PDF is likely scanned/image-based
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
/**
 * Text-layer pages are free to read (no API call), so the cap only bounds
 * CPU; MAX_OUTPUT_CHARS is the real ceiling on what reaches the KB. Vision
 * pages each cost one gpt-4.1-mini call at `detail: 'high'`, so they get a
 * tighter cap. Both are reported back as `pagesRead` / `pagesTotal` so the
 * merchant is told exactly what was skipped — a silent cap is how a merchant's
 * FAQ and "mandatory instructions" sections went missing on 2026-08-29.
 */
const MAX_PDF_PAGES = 20;
const MAX_PDF_VISION_PAGES = 10;
const MAX_OUTPUT_CHARS = 16_000; // Same as KB character limit

const ARABIC_SCRIPT = /[\u0600-\u06FF]/;

/**
 * A whitespace-separated token that is a number, date, time, range or amount
 * (`6--7`, `30/4/2026`, `50,000`, `٢٠٠٠`) — digits plus separators, no letters.
 * Anything carrying a letter (`ZNet-1.0.6.apk`, `iPhone15`) is a word.
 */
const NUMERIC_TOKEN = /^[\d٠-٩][\d٠-٩/:,.\-–—%]*$/;

/** How many consecutive data rows make a table (tables are contiguous). */
const MIN_TABLE_RUN = 3;
/** A data row is short: table cells, not sentences. */
const MAX_ROW_TOKENS = 8;
/** ...and dense in numbers: at least this share of its tokens are numeric. */
const MIN_NUMERIC_SHARE = 0.4;
/** A delimited row has at least this many cells... */
const MIN_CELLS = 3;
/** ...and no cell is a sentence. */
const MAX_CELL_WORDS = 4;

/** Column separators pdfjs emits: a tab, or a run of 3+ spaces. */
const CELL_DELIMITER = /\t| {3,}/;

/**
 * A single pdfjs line that reads like a TABLE ROW rather than prose.
 *
 * Shape only — no vocabulary, no vertical. Either the columns are visibly
 * delimited (3+ cells, each at most a few words), or the line is short and
 * dominated by numeric cells (a schedule row, a price row, a size chart).
 *
 * The cell-length check on delimited rows is not decoration: pdfjs pads
 * unmapped ligature glyphs with wide spaces, so a plain sentence in a
 * subsetted-font PDF comes out as «قلي   N   ي   السؤال غير مغطى…» — two
 * "gaps" and no table anywhere. A real row's cells are short; that sentence
 * has a six-word cell. A sentence that happens to contain a price (2 numeric
 * tokens out of 7) or a numbered heading (1 out of 5) never qualifies either.
 */
function isTableRow(line: string): boolean {
    const cells = line.trim().split(CELL_DELIMITER).filter((c) => c.trim().length > 0);
    if (cells.length >= MIN_CELLS) {
        return cells.every((c) => c.trim().split(/\s+/).length <= MAX_CELL_WORDS);
    }
    const tokens = line.trim().split(/\s+/);
    if (tokens.length < 2 || tokens.length > MAX_ROW_TOKENS) return false;
    const numeric = tokens.filter((t) => NUMERIC_TOKEN.test(t)).length;
    return numeric / tokens.length >= MIN_NUMERIC_SHARE;
}

/**
 * Does the text layer contain a table? A table is a RUN of row-shaped lines
 * (see `isTableRow`), so that is what we look for.
 *
 * This is a SIGNAL, not a verdict: the text layer is kept and handed to
 * Vision as the spelling authority (see `extractFromPdfViaVision`). It used
 * to be a verdict — any document with 30%+ "rows" (3 tokens + a digit) was
 * treated as scanned and its correct text layer thrown away in favour of OCR.
 * A numbered reference document trips that at 49%; a merchant's Arabic
 * manual came back with inverted meaning and invented words (2026-08-29).
 *
 * Gated on Arabic script deliberately: LTR text layers keep their column
 * order, and every escalation spends a plan-gated Vision call.
 */
export function looksTabular(text: string): boolean {
    if (!ARABIC_SCRIPT.test(text)) return false;
    let run = 0;
    for (const line of text.split('\n')) {
        if (line.trim().length === 0) { run = 0; continue; }
        run = isTableRow(line) ? run + 1 : 0;
        if (run >= MIN_TABLE_RUN) return true;
    }
    return false;
}

const VISION_MODEL = 'gpt-4.1-mini';

const VISION_PROMPT = `Extract ALL text from this image exactly as written.
Preserve Arabic text as-is. Never paraphrase, summarise, or "correct" a word.

For TABLES, follow this format strictly:
  1. Output the header row ONCE as the first line, with fields separated by " | ".
  2. Output each data row on ONE SINGLE LINE, with the same " | " separator.
  3. If a cell is visually merged across multiple rows (a name, category,
     size, or price that spans a group of rows), REPEAT that value on every
     single row it covers. Every data row MUST include every column: never
     leave a cell empty that is filled in the image.
  4. Do NOT output fields on separate lines. Do NOT drop any row.
  5. Read the table in its natural reading direction (right-to-left for Arabic).

For non-table content: output plain text, preserving headings and list structure.
No markdown, no formatting symbols.`;

/**
 * Appended when the page ALSO has a machine-readable text layer. The layer is
 * exact on WORDS and useless on layout; the image is the reverse. Anchoring
 * on the layer is what stops the model guessing words from their shapes — the
 * failure that turned «الكروت» into «الكُتُب».
 *
 * The layer is not flawless, though: subsetted Arabic fonts leave ligature
 * glyphs unmapped, so pdfjs emits «ل ا» for «لا» and a stray Latin letter
 * («K», «N») where a whole ligature stood — a merchant's 8.7k-char manual
 * carried 13 of the former and at least 40 of the latter (matchers validated
 * at 0 on the clean transcript). Those are glyph artifacts, not words, and
 * the image is the right source for them. Hence "words from the layer,
 * glyphs from the image, nothing from nowhere".
 */
const TEXT_LAYER_PROMPT = `The page's machine-extracted text layer follows between the markers.
Its WORDS are authoritative: output the words it contains, spelled as it
spells them. Use the image to recover table structure, column order, and
reading order. The text layer may carry glyph artifacts — a letter split off
its word by spaces (e.g. "ل ا" for "لا"), or a stray Latin letter standing in
for an Arabic glyph — resolve those from the image. Never output a word that
appears in neither the text layer nor the image.
<text_layer>
`;

export type ExtractionMethod = 'pdfjs' | 'mammoth' | 'gpt-vision' | 'exceljs';

export interface ExtractionResult {
    text: string;
    method: ExtractionMethod;
    isScanned?: boolean;       // PDF only — true if the PDF has no usable text layer
    tabular?: boolean;         // PDF only — text layer present but contains a table (Vision recovers layout)
    truncated?: boolean;       // true if output was capped at MAX_OUTPUT_CHARS
    pagesTruncated?: boolean;  // PDF only — true if pages were capped (see pagesRead / pagesTotal)
    pagesRead?: number;        // PDF only — pages actually processed
    pagesTotal?: number;       // PDF only — pages in the file
    /** PDF only — per-page text layer, for the Vision pass. Internal; the route strips it. */
    pageTexts?: string[];
}

/**
 * Truncate text to MAX_OUTPUT_CHARS if needed.
 */
function capText(text: string): { text: string; truncated: boolean } {
    if (text.length <= MAX_OUTPUT_CHARS) return { text, truncated: false };
    return { text: text.slice(0, MAX_OUTPUT_CHARS), truncated: true };
}

function validateSize(buffer: Buffer): void {
    if (buffer.length > MAX_FILE_SIZE_BYTES) {
        throw new Error(`File too large: ${(buffer.length / 1024 / 1024).toFixed(1)}MB exceeds 5MB limit`);
    }
}

/**
 * Extract text from a PDF buffer using pdfjs-dist directly.
 * Reads up to MAX_PDF_PAGES pages. Marks `isScanned` when there is no usable
 * text layer (→ Vision OCR), and `tabular` when the text layer contains a
 * table (→ Vision recovers the layout, with this text as spelling reference).
 * A text layer that exists is always returned — it is never discarded.
 *
 * We use pdfjs-dist directly (same version pdf-to-img uses) so there is exactly
 * one PDF engine in the process.
 */
export async function extractFromPDF(buffer: Buffer): Promise<ExtractionResult> {
    validateSize(buffer);

    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({
        data: new Uint8Array(buffer),
        isEvalSupported: false,
        useSystemFonts: true,
    }).promise;

    const pagesTotal = doc.numPages;
    const pagesRead = Math.min(pagesTotal, MAX_PDF_PAGES);
    const pagesTruncated = pagesTotal > pagesRead;

    // One entry per page read (empty string for a blank page) so the Vision
    // pass can pair page i's image with page i's text layer.
    const pageTexts: string[] = [];
    for (let i = 1; i <= pagesRead; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        // Preserve line structure: pdfjs sets hasEOL at natural line breaks.
        // Without this, tables collapse into one line and the tabular-table
        // heuristic can't detect them.
        let pageText = '';
        for (const item of content.items) {
            if (!('str' in item)) continue;
            pageText += item.str;
            if (item.hasEOL) pageText += '\n';
            else pageText += ' ';
        }
        pageTexts.push(pageText.trim());
        page.cleanup();
    }
    await doc.destroy();

    const rawText = pageTexts.filter((t) => t.length > 0).join('\n\n').trim();
    const pageMeta = { pagesTruncated, pagesRead, pagesTotal };

    if (rawText.length < SCANNED_PDF_THRESHOLD) {
        return { text: rawText, method: 'pdfjs', isScanned: true, ...pageMeta };
    }

    const { text, truncated } = capText(rawText);
    return {
        text, method: 'pdfjs', isScanned: false, truncated,
        tabular: looksTabular(rawText), pageTexts, ...pageMeta,
    };
}

/**
 * Extract text from a Word (.docx) buffer.
 * Uses mammoth to convert to plain text (strips formatting).
 */
export async function extractFromWord(buffer: Buffer): Promise<ExtractionResult> {
    validateSize(buffer);

    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    const rawText = result.value?.trim() || '';
    const { text, truncated } = capText(rawText);
    return { text, method: 'mammoth', truncated };
}

/**
 * Extract text from an Excel (.xlsx) buffer.
 * Uses exceljs. Merged cells are expanded so every row is self-contained.
 * Each sheet is serialized as tab-separated rows; multiple sheets are
 * separated by a `=== <sheet name> ===` header so the AI can tell them apart.
 */
export async function extractFromSpreadsheet(buffer: Buffer): Promise<ExtractionResult> {
    validateSize(buffer);

    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    // exceljs typings expect the legacy Buffer shape; @types/node 20 widened it.
    // Pass the underlying ArrayBuffer — exceljs accepts ArrayBuffer at runtime.
    const u8 = new Uint8Array(buffer);
    await workbook.xlsx.load(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer);

    const multiSheet = workbook.worksheets.length > 1;
    const blocks: string[] = [];

    workbook.eachSheet((worksheet) => {
        const rows: string[] = [];
        worksheet.eachRow({ includeEmpty: false }, (row) => {
            const values: string[] = [];
            row.eachCell({ includeEmpty: true }, (cell) => {
                // For merged cells, cell.master holds the real value on non-master cells
                const source = cell.isMerged && cell.master ? cell.master : cell;
                const raw = source.text ?? source.value;
                values.push(String(raw ?? '').trim());
            });
            if (values.some((v) => v.length > 0)) {
                rows.push(values.join('\t'));
            }
        });
        if (rows.length === 0) return;
        blocks.push(multiSheet ? `=== ${worksheet.name} ===\n${rows.join('\n')}` : rows.join('\n'));
    });

    const rawText = blocks.join('\n\n').trim();
    const { text, truncated } = capText(rawText);
    return { text, method: 'exceljs', truncated };
}

/**
 * Render up to MAX_PDF_VISION_PAGES pages of a PDF into PNG buffers.
 * Uses pdf-to-img (pdfjs-dist + @napi-rs/canvas). `scale: 2` ≈ 150 DPI,
 * which is enough for Vision to read 10pt text reliably without burning tokens.
 */
async function renderPdfToImages(buffer: Buffer): Promise<{ pages: Buffer[]; pagesTotal: number }> {
    const { pdf } = await import('pdf-to-img');
    const doc = await pdf(buffer, { scale: 2 });
    const pages: Buffer[] = [];
    for await (const page of doc) {
        pages.push(page);
        if (pages.length >= MAX_PDF_VISION_PAGES) break;
    }
    return { pages, pagesTotal: doc.length };
}

export interface PdfVisionOptions {
    /**
     * Per-page text layer from `extractFromPDF`, when the PDF has one. Sent
     * alongside each page image as the spelling authority — Vision then only
     * recovers layout. Omit for scanned PDFs (there is nothing to send).
     */
    pageTexts?: string[];
}

/**
 * Extract text from a PDF by rasterizing each page and sending it to Vision.
 * Two callers: scanned PDFs (no text layer → pure OCR) and text-layer PDFs
 * whose layout pdfjs scrambled (tables → OCR anchored on the text layer).
 * Requires OPENAI_API_KEY.
 */
export async function extractFromPdfViaVision(
    buffer: Buffer,
    ctx: VisionContext,
    opts: PdfVisionOptions = {},
): Promise<ExtractionResult> {
    const apiKey = config.openai?.apiKey;
    if (!apiKey) {
        throw new Error('OpenAI API key not configured — cannot extract text from PDF via Vision');
    }

    validateSize(buffer);

    const { pages, pagesTotal } = await renderPdfToImages(buffer);
    const pagesRead = pages.length;
    const pageMeta = { pagesRead, pagesTotal, pagesTruncated: pagesTotal > pagesRead };
    if (pagesRead === 0) {
        return { text: '', method: 'gpt-vision', truncated: false, ...pageMeta };
    }

    const openai = makeTrackedOpenAI(apiKey, {
        userId: ctx.userId,
        pageId: ctx.pageId,
        pipeline: ctx.pipeline ?? 'kb_file_extraction',
    });
    const pageTexts: string[] = [];
    for (const [i, png] of pages.entries()) {
        const base64 = png.toString('base64');
        const layer = opts.pageTexts?.[i]?.trim();
        const prompt = layer
            ? `${VISION_PROMPT}\n\n${TEXT_LAYER_PROMPT}${layer}\n</text_layer>`
            : VISION_PROMPT;
        const response = await openai.chat.completions.create({
            model: VISION_MODEL,
            max_tokens: 4096,
            messages: [{
                role: 'user',
                content: [
                    { type: 'text', text: prompt },
                    { type: 'image_url', image_url: { url: `data:image/png;base64,${base64}`, detail: 'high' } },
                ],
            }],
        });
        const pageText = response.choices[0]?.message?.content?.trim() || '';
        if (pageText) pageTexts.push(pageText);
    }

    const rawText = pageTexts.join('\n\n').trim();
    const { text, truncated } = capText(rawText);
    return { text, method: 'gpt-vision', truncated, ...pageMeta };
}

/**
 * Extract text from an image (or scanned PDF page) using GPT-4o-mini Vision.
 * Requires OPENAI_API_KEY to be configured.
 */
export async function extractFromImage(buffer: Buffer, mimeType: string, ctx: VisionContext): Promise<ExtractionResult> {
    const apiKey = config.openai?.apiKey;
    if (!apiKey) {
        throw new Error('OpenAI API key not configured — cannot extract text from image');
    }

    validateSize(buffer);

    const base64 = buffer.toString('base64');
    const dataUrl = `data:${mimeType};base64,${base64}`;

    const openai = makeTrackedOpenAI(apiKey, {
        userId: ctx.userId,
        pageId: ctx.pageId,
        pipeline: ctx.pipeline ?? 'kb_file_extraction',
    });
    const response = await openai.chat.completions.create({
        model: VISION_MODEL,
        max_tokens: 4096,
        messages: [
            {
                role: 'user',
                content: [
                    { type: 'text', text: VISION_PROMPT },
                    { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
                ],
            },
        ],
    });

    const rawText = response.choices[0]?.message?.content?.trim() || '';
    const { text, truncated } = capText(rawText);
    return { text, method: 'gpt-vision', truncated };
}

/**
 * Sniff the actual MIME type from a buffer's magic bytes.
 *
 * Clients sometimes send a file with a misleading MIME (HEIC labeled as jpeg,
 * renamed extensions, corrupted images). OpenAI Vision then rejects with a
 * 400 that we'd otherwise surface as an opaque 500. Checking magic bytes up
 * front lets us return a clear, user-facing error before spending an API call.
 *
 * Returns the detected MIME or `null` when the format is unrecognised.
 */
export function sniffMimeType(buffer: Buffer): string | null {
    if (buffer.length < 4) return null;

    // JPEG: FF D8 FF
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        return 'image/jpeg';
    }
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (
        buffer.length >= 8 &&
        buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
        buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
    ) {
        return 'image/png';
    }
    // WEBP: "RIFF"....WEBP
    if (
        buffer.length >= 12 &&
        buffer.toString('ascii', 0, 4) === 'RIFF' &&
        buffer.toString('ascii', 8, 12) === 'WEBP'
    ) {
        return 'image/webp';
    }
    // PDF: %PDF-
    if (buffer.toString('ascii', 0, 5) === '%PDF-') {
        return 'application/pdf';
    }
    // ZIP container (docx, xlsx): 50 4B 03 04
    if (buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) {
        return 'application/zip';
    }
    // OLE compound doc (legacy .doc): D0 CF 11 E0 A1 B1 1A E1
    if (
        buffer.length >= 8 &&
        buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0 &&
        buffer[4] === 0xa1 && buffer[5] === 0xb1 && buffer[6] === 0x1a && buffer[7] === 0xe1
    ) {
        return 'application/x-ole-storage';
    }
    return null;
}

/**
 * Verify the buffer's actual content matches the declared MIME. Returns true
 * when the content is consistent with the declared type, false otherwise.
 *
 * docx/xlsx both sit inside a ZIP container, so a ZIP magic is accepted for
 * either — distinguishing the two would require inspecting `[Content_Types].xml`
 * and the downstream extractors already fail cleanly on a wrong Office variant.
 */
export function bufferMatchesMime(buffer: Buffer, declaredMime: string): boolean {
    const sniffed = sniffMimeType(buffer);
    if (!sniffed) return false;
    if (sniffed === declaredMime) return true;
    // Office containers: both docx and xlsx sit in ZIP; accept either way.
    if (sniffed === 'application/zip') {
        return (
            declaredMime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
            declaredMime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
    }
    if (sniffed === 'application/x-ole-storage' && declaredMime === 'application/msword') {
        return true;
    }
    return false;
}

/** Supported MIME types for file upload */
export const SUPPORTED_MIME_TYPES = new Set([
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
    'application/msword', // .doc (legacy — mammoth only supports .docx)
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
    'image/jpeg',
    'image/png',
    'image/webp',
]);

/** MIME types handled by the spreadsheet extractor */
export const SPREADSHEET_MIME_TYPES = new Set([
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
]);

/** MIME types that require GPT Vision (plan-gated + quota-limited) */
export const VISION_MIME_TYPES = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
]);

export { MAX_FILE_SIZE_BYTES, MAX_PDF_PAGES, MAX_PDF_VISION_PAGES, MAX_OUTPUT_CHARS, VISION_MODEL };
