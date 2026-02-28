import { normalizeArabic } from '@jawab24/shared';

export interface KbChunk {
    type: 'offering' | 'policy' | 'faq' | 'info' | 'hours' | 'location' | 'contact' | 'product';
    title: string;
    contentOriginal: string;
    contentNormalized: string;
    titleNormalized: string;
    language: string;
    tokenCount: number;
    metadata: Record<string, unknown>;
}

export interface ProductData {
    platformProductId: string;
    handle?: string | null;
    productUrl?: string | null;
    title: string;
    description?: string | null;
    productType?: string | null;
    vendor?: string | null;
    status: string;
    priceRange?: string | null;
    currency?: string | null;
    totalInventory: number;
    hasVariants: boolean;
    variantSummary?: string | null;
    tags?: string | null;
}

/** Rough token estimate — Arabic averages ~3.5 chars/token */
function estimateTokens(text: string): number {
    return Math.ceil(text.length / 3.5);
}

/** Detect language by Arabic character ratio */
function detectChunkLanguage(text: string): string {
    const arabicChars = (text.match(/[\u0600-\u06FF]/g) || []).length;
    return arabicChars / Math.max(text.length, 1) > 0.3 ? 'ar' : 'en';
}

/** Max tokens per chunk before splitting */
const MAX_CHUNK_TOKENS = 800;
/** Overlap in characters when splitting long text */
const OVERLAP_CHARS = 100;

/**
 * Known section headers (Arabic + English) that indicate chunk boundaries.
 * Case-insensitive matching is done after normalization.
 */
const SECTION_PATTERNS: { pattern: RegExp; type: KbChunk['type'] }[] = [
    { pattern: /^(delivery|shipping|توصيل|شحن)/i, type: 'policy' },
    { pattern: /^(return|refund|exchange|ارجاع|استبدال|استرجاع)/i, type: 'policy' },
    { pattern: /^(payment|دفع|طرق الدفع)/i, type: 'policy' },
    { pattern: /^(warranty|ضمان|كفالة)/i, type: 'policy' },
    { pattern: /^(hours|ساعات|مواعيد|أوقات العمل)/i, type: 'hours' },
    { pattern: /^(location|address|عنوان|موقع|فرع)/i, type: 'location' },
    { pattern: /^(phone|contact|هاتف|تواصل|اتصال)/i, type: 'contact' },
    { pattern: /^(faq|أسئلة|الأسئلة الشائعة)/i, type: 'faq' },
    { pattern: /^(menu|قائمة|منيو)/i, type: 'offering' },
    { pattern: /^(products?|services?|منتجات|خدمات)/i, type: 'offering' },
    { pattern: /^(prices?|pricing|أسعار|سعر)/i, type: 'offering' },
];

/** Strip leading emoji and variation selectors from text */
function stripLeadingEmoji(text: string): string {
    return text.replace(/^(?:[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2300}-\u{23FF}]|\u{FE0F}|\u{200D}|\s)+/gu, '');
}

/** Detect chunk type from title or content */
function detectChunkType(title: string, content: string): KbChunk['type'] {
    const raw = title || content.slice(0, 100);
    const textToCheck = stripLeadingEmoji(raw);
    for (const { pattern, type } of SECTION_PATTERNS) {
        if (pattern.test(textToCheck)) return type;
    }
    return 'info';
}

/**
 * Split long text into smaller chunks with overlap.
 * Tries to split at paragraph or sentence boundaries.
 */
function splitLongText(text: string, maxTokens: number): string[] {
    if (estimateTokens(text) <= maxTokens) return [text];

    const maxChars = Math.floor(maxTokens * 3.5);
    const chunks: string[] = [];
    let start = 0;

    while (start < text.length) {
        let end = start + maxChars;
        if (end >= text.length) {
            chunks.push(text.slice(start).trim());
            break;
        }

        // Try to break at paragraph boundary
        const paragraphBreak = text.lastIndexOf('\n\n', end);
        if (paragraphBreak > start + maxChars * 0.3) {
            end = paragraphBreak;
        } else {
            // Try sentence boundary (. or 。 followed by space/newline)
            const sentenceBreak = text.lastIndexOf('. ', end);
            if (sentenceBreak > start + maxChars * 0.3) {
                end = sentenceBreak + 1;
            }
        }

        chunks.push(text.slice(start, end).trim());
        start = Math.max(start + 1, end - OVERLAP_CHARS);
    }

    return chunks.filter(c => c.length > 0);
}

/**
 * Parse raw KB text into typed, normalized chunks ready for embedding.
 *
 * Splitting strategy:
 * 1. Split by double-newline into sections
 * 2. Detect type per section from headers/content
 * 3. Split oversized sections further with overlap
 * 4. Normalize all text with normalizeArabic()
 */
export function chunkKnowledgeBase(rawText: string): KbChunk[] {
    if (!rawText || !rawText.trim()) return [];

    const sections = rawText.split(/\n\n+/).filter(s => s.trim());
    const chunks: KbChunk[] = [];

    for (const section of sections) {
        const lines = section.split('\n');

        // First line could be a header if it's short
        let title = '';
        let content = section;
        if (lines.length > 1 && lines[0].length < 100) {
            // Remove common header markers (emoji, #, -, etc.)
            title = lines[0].replace(/^[\s#\-*•]+/, '').replace(/(?:[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2300}-\u{23FF}]|\u{FE0F}|\u{200D})/gu, '').trim();
            content = lines.slice(1).join('\n').trim();
        }

        // If the section is just a single short line, use it as both title and content
        if (!content && title) {
            content = title;
        }

        if (!content) continue;

        const type = detectChunkType(title, content);
        const textParts = splitLongText(content, MAX_CHUNK_TOKENS);

        for (let i = 0; i < textParts.length; i++) {
            const partContent = textParts[i];
            const partTitle = textParts.length > 1
                ? `${title} (${i + 1}/${textParts.length})`
                : title;

            chunks.push({
                type,
                title: partTitle,
                contentOriginal: partContent,
                contentNormalized: normalizeArabic(partContent),
                titleNormalized: normalizeArabic(partTitle),
                language: detectChunkLanguage(partContent),
                tokenCount: estimateTokens(partContent),
                metadata: {},
            });
        }
    }

    return chunks;
}

/**
 * Generate chunks from a structured business profile.
 * Creates dedicated chunks for hours, location, contact even if KB is empty.
 */
export function chunkBusinessProfile(profile: Record<string, unknown>): KbChunk[] {
    const chunks: KbChunk[] = [];

    // Hours chunk
    if (profile.hours && typeof profile.hours === 'object') {
        const hoursObj = profile.hours as Record<string, string[]>;
        const dayNames: Record<string, string> = {
            mon: 'Monday/الإثنين', tue: 'Tuesday/الثلاثاء', wed: 'Wednesday/الأربعاء',
            thu: 'Thursday/الخميس', fri: 'Friday/الجمعة', sat: 'Saturday/السبت', sun: 'Sunday/الأحد',
        };
        const lines = Object.entries(hoursObj)
            .map(([day, slots]) => `${dayNames[day] || day}: ${(slots as string[]).join(', ')}`)
            .join('\n');
        if (lines) {
            chunks.push({
                type: 'hours',
                title: 'Business Hours / ساعات العمل',
                contentOriginal: lines,
                contentNormalized: normalizeArabic(lines),
                titleNormalized: normalizeArabic('Business Hours ساعات العمل'),
                language: 'ar',
                tokenCount: estimateTokens(lines),
                metadata: { source: 'businessProfile' },
            });
        }
    }

    // Location chunk
    const addressParts = [profile.address, profile.city, profile.country].filter(Boolean);
    if (addressParts.length > 0) {
        const content = addressParts.join(', ');
        chunks.push({
            type: 'location',
            title: 'Location / الموقع',
            contentOriginal: content,
            contentNormalized: normalizeArabic(content),
            titleNormalized: normalizeArabic('Location الموقع'),
            language: detectChunkLanguage(content),
            tokenCount: estimateTokens(content),
            metadata: { source: 'businessProfile' },
        });
    }

    // Contact chunk
    const contactParts: string[] = [];
    if (profile.phone) contactParts.push(`Phone: ${profile.phone}`);
    if (profile.website) contactParts.push(`Website: ${profile.website}`);
    if (contactParts.length > 0) {
        const content = contactParts.join('\n');
        chunks.push({
            type: 'contact',
            title: 'Contact / التواصل',
            contentOriginal: content,
            contentNormalized: normalizeArabic(content),
            titleNormalized: normalizeArabic('Contact التواصل'),
            language: 'en',
            tokenCount: estimateTokens(content),
            metadata: { source: 'businessProfile' },
        });
    }

    // About chunk
    if (profile.about && typeof profile.about === 'string') {
        chunks.push({
            type: 'info',
            title: (profile.name as string) || 'About / نبذة',
            contentOriginal: profile.about,
            contentNormalized: normalizeArabic(profile.about),
            titleNormalized: normalizeArabic((profile.name as string) || 'About نبذة'),
            language: detectChunkLanguage(profile.about),
            tokenCount: estimateTokens(profile.about),
            metadata: { source: 'businessProfile' },
        });
    }

    return chunks;
}

/**
 * Convert structured e-commerce product rows into KbChunk[] for embedding.
 * Each active product becomes one or more chunks with type 'product'.
 * Long descriptions are split with overlap to stay under MAX_CHUNK_TOKENS.
 */
export function chunkProducts(products: ProductData[]): KbChunk[] {
    const chunks: KbChunk[] = [];

    for (const p of products) {
        if (p.status !== 'active') continue;

        const lines: string[] = [`Product: ${p.title} (ID: ${p.platformProductId})`];
        if (p.description) lines.push(p.description);
        if (p.productType) lines.push(`Category: ${p.productType}`);
        if (p.vendor) lines.push(`Vendor: ${p.vendor}`);
        if (p.priceRange) {
            const priceStr = p.currency ? `${p.priceRange} ${p.currency}` : p.priceRange;
            lines.push(`Price: ${priceStr}`);
        }
        if (p.hasVariants && p.variantSummary) {
            lines.push(`Variants: ${p.variantSummary}`);
        }
        if (p.totalInventory === 0) lines.push('Availability: out of stock');
        else if (p.totalInventory <= 5) lines.push('Availability: low stock');
        else lines.push('Availability: in stock');
        if (p.tags) lines.push(`Tags: ${p.tags}`);
        if (p.productUrl) lines.push(`URL: ${p.productUrl}`);

        const content = lines.join('\n');
        const textParts = splitLongText(content, MAX_CHUNK_TOKENS);

        for (let i = 0; i < textParts.length; i++) {
            const partContent = textParts[i];
            const partTitle = textParts.length > 1
                ? `${p.title} (${i + 1}/${textParts.length})`
                : p.title;

            chunks.push({
                type: 'product' as const,
                title: partTitle,
                contentOriginal: partContent,
                contentNormalized: normalizeArabic(partContent),
                titleNormalized: normalizeArabic(partTitle),
                language: detectChunkLanguage(p.title),
                tokenCount: estimateTokens(partContent),
                metadata: { source: 'ecommerce', platformProductId: p.platformProductId },
            });
        }
    }

    return chunks;
}
