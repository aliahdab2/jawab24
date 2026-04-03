import OpenAI from 'openai';
import { config } from '../../config';

const SCANNED_PDF_THRESHOLD = 50; // chars — below this, PDF is likely scanned/image-based
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
const MAX_PDF_PAGES = 5;
const MAX_OUTPUT_CHARS = 16_000; // Same as KB character limit

const VISION_MODEL = 'gpt-4o-mini';

const VISION_PROMPT = `Extract ALL text from this image exactly as written.
Preserve the structure: headings, lists, prices, tables.
Output plain text only — no markdown, no formatting symbols.
If the text is in Arabic, preserve Arabic text as-is.`;

export type ExtractionMethod = 'pdf-parse' | 'mammoth' | 'gpt-vision';

export interface ExtractionResult {
    text: string;
    method: ExtractionMethod;
    isScanned?: boolean;       // PDF only — true if text extraction yielded little/no text
    truncated?: boolean;       // true if output was capped at MAX_OUTPUT_CHARS
    pagesTruncated?: boolean;  // PDF only — true if pages were capped at MAX_PDF_PAGES
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
 * Extract text from a PDF buffer.
 * Uses pdf-parse v2 (class-based API). Limits to first MAX_PDF_PAGES pages.
 * If extracted text is too short, marks as scanned for Vision fallback.
 */
export async function extractFromPDF(buffer: Buffer): Promise<ExtractionResult> {
    validateSize(buffer);

    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    const result = await parser.getText({ first: MAX_PDF_PAGES });
    const rawText = result.text?.trim() || '';
    const totalPages = result.total || 0;
    const pagesTruncated = totalPages > MAX_PDF_PAGES;

    await parser.destroy();

    if (rawText.length < SCANNED_PDF_THRESHOLD) {
        return { text: rawText, method: 'pdf-parse', isScanned: true, pagesTruncated };
    }

    const { text, truncated } = capText(rawText);
    return { text, method: 'pdf-parse', isScanned: false, truncated, pagesTruncated };
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
 * Extract text from an image (or scanned PDF page) using GPT-4o-mini Vision.
 * Requires OPENAI_API_KEY to be configured.
 */
export async function extractFromImage(buffer: Buffer, mimeType: string): Promise<ExtractionResult> {
    const apiKey = config.openai?.apiKey;
    if (!apiKey) {
        throw new Error('OpenAI API key not configured — cannot extract text from image');
    }

    validateSize(buffer);

    const base64 = buffer.toString('base64');
    const dataUrl = `data:${mimeType};base64,${base64}`;

    const openai = new OpenAI({ apiKey });
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

/** Supported MIME types for file upload */
export const SUPPORTED_MIME_TYPES = new Set([
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
    'application/msword', // .doc (legacy — mammoth only supports .docx)
    'image/jpeg',
    'image/png',
    'image/webp',
]);

/** MIME types that require GPT Vision (plan-gated + quota-limited) */
export const VISION_MIME_TYPES = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
]);

export { MAX_FILE_SIZE_BYTES, MAX_PDF_PAGES, MAX_OUTPUT_CHARS };
