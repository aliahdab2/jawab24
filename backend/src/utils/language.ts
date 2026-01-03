/**
 * Language Detection Utility
 * 
 * Detects the language of text using Unicode character ranges and common patterns.
 * Supports: Arabic, English, Swedish (can be extended)
 */

// Unicode ranges for different scripts
const ARABIC_RANGE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
const HEBREW_RANGE = /[\u0590-\u05FF]/;
const CYRILLIC_RANGE = /[\u0400-\u04FF]/;
const CJK_RANGE = /[\u4E00-\u9FFF\u3400-\u4DBF]/;
const KOREAN_RANGE = /[\uAC00-\uD7AF\u1100-\u11FF]/;
const JAPANESE_RANGE = /[\u3040-\u309F\u30A0-\u30FF]/;
const THAI_RANGE = /[\u0E00-\u0E7F]/;

// Extended Latin characters for specific languages
const SWEDISH_CHARS = /[åäöÅÄÖ]/;
const GERMAN_CHARS = /[äöüßÄÖÜ]/;
const FRENCH_CHARS = /[àâæçéèêëïîôùûüÿœÀÂÆÇÉÈÊËÏÎÔÙÛÜŸŒ]/;
const SPANISH_CHARS = /[áéíóúüñÁÉÍÓÚÜÑ¿¡]/;
const TURKISH_CHARS = /[çğıöşüÇĞİÖŞÜ]/;

// Common words for additional context
const ARABIC_COMMON = ['في', 'من', 'على', 'إلى', 'هل', 'ما', 'كيف', 'مرحبا', 'شكرا', 'أهلا', 'السلام'];
const ENGLISH_COMMON = ['the', 'is', 'are', 'and', 'or', 'but', 'with', 'for', 'from', 'have', 'has', 'been'];
const SWEDISH_COMMON = ['och', 'det', 'att', 'som', 'på', 'är', 'av', 'för', 'med', 'har'];

export type SupportedLanguage = 'ar' | 'en' | 'sv' | 'de' | 'fr' | 'es' | 'tr' | 'unknown';

export interface LanguageDetectionResult {
    language: SupportedLanguage;
    confidence: number; // 0-1
    script: string;
    isRTL: boolean;
}

/**
 * Detect the language of a text string
 */
export function detectLanguage(text: string): LanguageDetectionResult {
    if (!text || text.trim().length === 0) {
        return {
            language: 'unknown',
            confidence: 0,
            script: 'unknown',
            isRTL: false,
        };
    }

    const cleanText = text.trim();
    
    // Check for Arabic script (most reliable due to unique character range)
    // Even a single Arabic character means it's likely Arabic content
    const arabicRegex = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g;
    const arabicMatches = cleanText.match(arabicRegex);
    if (arabicMatches && arabicMatches.length > 0) {
        // Remove emojis, spaces, numbers, and punctuation for ratio calculation
        const textWithoutSpaces = cleanText.replace(/[\s\d\u{1F300}-\u{1F9FF}!?؟.,،;:'"()[\]{}]/gu, '');
        const arabicRatio = textWithoutSpaces.length > 0 
            ? arabicMatches.length / textWithoutSpaces.length 
            : 1;
        
        // If any Arabic content exists, detect as Arabic (Arabic users often mix with emojis/punctuation)
        if (arabicMatches.length >= 1) {
            return {
                language: 'ar',
                confidence: Math.min(arabicRatio * 1.5, 1),
                script: 'Arabic',
                isRTL: true,
            };
        }
    }

    // Check for Hebrew
    if (HEBREW_RANGE.test(cleanText)) {
        return {
            language: 'unknown', // We don't officially support Hebrew yet
            confidence: 0.8,
            script: 'Hebrew',
            isRTL: true,
        };
    }

    // Check for CJK characters
    if (CJK_RANGE.test(cleanText)) {
        return {
            language: 'unknown',
            confidence: 0.8,
            script: 'CJK',
            isRTL: false,
        };
    }

    // Check for Japanese
    if (JAPANESE_RANGE.test(cleanText)) {
        return {
            language: 'unknown',
            confidence: 0.8,
            script: 'Japanese',
            isRTL: false,
        };
    }

    // Check for Korean
    if (KOREAN_RANGE.test(cleanText)) {
        return {
            language: 'unknown',
            confidence: 0.8,
            script: 'Korean',
            isRTL: false,
        };
    }

    // Check for Cyrillic
    if (CYRILLIC_RANGE.test(cleanText)) {
        return {
            language: 'unknown',
            confidence: 0.8,
            script: 'Cyrillic',
            isRTL: false,
        };
    }

    // Check for Thai
    if (THAI_RANGE.test(cleanText)) {
        return {
            language: 'unknown',
            confidence: 0.8,
            script: 'Thai',
            isRTL: false,
        };
    }

    // For Latin script, use extended characters and common words
    const lowerText = cleanText.toLowerCase();
    const words = lowerText.split(/\s+/);

    // Turkish check (has unique chars like ş, ğ, ı that others don't have)
    if (TURKISH_CHARS.test(cleanText) && /\b(ve|bir|bu|için|ile|de|da|mi|mu|ne)\b/i.test(cleanText)) {
        return {
            language: 'tr',
            confidence: 0.85,
            script: 'Latin',
            isRTL: false,
        };
    }

    // German check - check before Swedish since they share some chars (ö, ü, ä)
    // German is detected by chars + common German words
    if (GERMAN_CHARS.test(cleanText) && /\b(und|ist|das|der|die|ein|eine|nicht|sehr|ich|bin)\b/i.test(cleanText)) {
        return {
            language: 'de',
            confidence: 0.8,
            script: 'Latin',
            isRTL: false,
        };
    }

    // Swedish check - only check special Swedish chars (å) which German doesn't have
    // or check common Swedish words if chars are ambiguous
    if (/[åÅ]/.test(cleanText)) {
        return {
            language: 'sv',
            confidence: 0.9,
            script: 'Latin',
            isRTL: false,
        };
    }

    // Check for Swedish using common words + Swedish chars without å
    if (SWEDISH_CHARS.test(cleanText)) {
        const swedishMatches = words.filter(w => SWEDISH_COMMON.includes(w)).length;
        if (swedishMatches >= 1) {
            return {
                language: 'sv',
                confidence: 0.85,
                script: 'Latin',
                isRTL: false,
            };
        }
    }

    // Check common words for Swedish (without special chars)
    const swedishMatches = words.filter(w => SWEDISH_COMMON.includes(w)).length;
    if (swedishMatches >= 2) {
        return {
            language: 'sv',
            confidence: 0.7 + (swedishMatches * 0.05),
            script: 'Latin',
            isRTL: false,
        };
    }

    // Turkish check (fallback without word check, just unique chars)
    if (/[ğıİşŞçÇ]/.test(cleanText)) {
        return {
            language: 'tr',
            confidence: 0.75,
            script: 'Latin',
            isRTL: false,
        };
    }

    // French check
    if (FRENCH_CHARS.test(cleanText) && /\b(le|la|les|et|est|que|qui|de|du|des)\b/i.test(cleanText)) {
        return {
            language: 'fr',
            confidence: 0.8,
            script: 'Latin',
            isRTL: false,
        };
    }

    // Spanish check
    if (SPANISH_CHARS.test(cleanText) && /\b(el|la|los|las|es|que|de|en|un|una)\b/i.test(cleanText)) {
        return {
            language: 'es',
            confidence: 0.8,
            script: 'Latin',
            isRTL: false,
        };
    }

    // Default to English for Latin script
    const englishMatches = words.filter(w => ENGLISH_COMMON.includes(w)).length;
    const confidence = Math.min(0.5 + (englishMatches * 0.1), 0.9);

    return {
        language: 'en',
        confidence,
        script: 'Latin',
        isRTL: false,
    };
}

/**
 * Simple language code detection (returns just the language code)
 */
export function detectLanguageCode(text: string): SupportedLanguage {
    return detectLanguage(text).language;
}

/**
 * Check if text is RTL
 */
export function isRTL(text: string): boolean {
    return detectLanguage(text).isRTL;
}

/**
 * Map language code to full name
 */
export function getLanguageName(code: SupportedLanguage): string {
    const names: Record<SupportedLanguage, string> = {
        ar: 'Arabic',
        en: 'English',
        sv: 'Swedish',
        de: 'German',
        fr: 'French',
        es: 'Spanish',
        tr: 'Turkish',
        unknown: 'Unknown',
    };
    return names[code] || 'Unknown';
}
