import { normalizeArabic } from '@jawab24/shared';

/**
 * Server-side offensive content filter.
 * Pre-GPT safety net that catches obvious profanity GPT might misclassify.
 * This ensures offensive messages are always skipped, regardless of GPT's intent.
 */

// Arabic offensive words — common insults, profanity, slurs
const ARABIC_OFFENSIVE_WORDS = [
    // Animal insults
    'حمير', 'حمار', 'كلب', 'خنزير', 'حيوان', 'بهيمة', 'ثور',
    // Intelligence insults
    'غبي', 'احمق', 'معتوه', 'متخلف', 'تافه',
    // Character insults
    'نصاب', 'نصابين', 'حرامي', 'حرامية', 'كذاب',
    // Profanity / vulgar
    'زبالة', 'زباله', 'منيك', 'كس', 'شرموط', 'شرموطة', 'عرص', 'زق', 'طيز', 'كسمك',
    // Contempt expressions
    'تفو', 'لعنة', 'يلعن',
];

// English offensive words
const ENGLISH_OFFENSIVE_WORDS = [
    'fuck', 'fucking', 'fucker', 'motherfucker',
    'shit', 'shitty', 'bullshit',
    'asshole', 'bitch', 'bastard', 'cunt',
    'dick', 'piss', 'stfu', 'wtf',
];

// Pre-normalize Arabic words once at module load
const NORMALIZED_ARABIC = ARABIC_OFFENSIVE_WORDS.map(w => normalizeArabic(w.toLowerCase()));

function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Check if text contains offensive content using a blocklist.
 *
 * Arabic: substring matching (handles conjugations, prefixes like "يا حمير")
 * English: word-boundary matching (avoids "class" matching "ass")
 */
export function isOffensiveContent(text: string): boolean {
    if (!text || text.trim().length === 0) return false;

    const normalizedText = normalizeArabic(text.toLowerCase());

    // Check Arabic offensive words (substring — handles "يا حمير انتم")
    for (const word of NORMALIZED_ARABIC) {
        if (normalizedText.includes(word)) return true;
    }

    // Check English offensive words (word boundary — avoids false positives)
    const lowerText = text.toLowerCase();
    for (const word of ENGLISH_OFFENSIVE_WORDS) {
        const pattern = new RegExp(`\\b${escapeRegex(word)}\\b`, 'i');
        if (pattern.test(lowerText)) return true;
    }

    return false;
}
