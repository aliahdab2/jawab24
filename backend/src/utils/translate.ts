import axios from 'axios';
import { detectLanguageCode } from './language';
import { config } from '../config';

export interface TranslateResult {
    en: string;
    ar: string;
    sourceLang: string;
    translated: boolean;
}

/**
 * Translate text between English and Arabic using OpenAI.
 * Graceful fallback: on failure returns source text only.
 */
export async function translateText(
    text: string,
    options?: { maxLength?: number },
): Promise<TranslateResult> {
    const maxLen = options?.maxLength;

    if (!text || !text.trim()) {
        return { en: '', ar: '', sourceLang: 'en', translated: false };
    }

    const sourceLang = detectLanguageCode(text);
    // For non-ar/en languages, treat as English
    const effectiveSource = sourceLang === 'ar' ? 'ar' : 'en';
    const targetLang = effectiveSource === 'ar' ? 'en' : 'ar';
    const targetLabel = targetLang === 'ar' ? 'Arabic' : 'English';

    if (!config.openai?.apiKey) {
        return {
            en: effectiveSource === 'en' ? text : text,
            ar: effectiveSource === 'ar' ? text : text,
            sourceLang: effectiveSource,
            translated: false,
        };
    }

    // Extract template variables like {name}, {product} before translation
    const vars: string[] = [];
    const sanitized = text.replace(/\{(\w+)\}/g, (match) => {
        const idx = vars.length;
        vars.push(match);
        return `__VAR${idx}__`;
    });

    try {
        const maxLenInstruction = maxLen ? ` Max ${maxLen} characters.` : '';

        const response = await axios.post<{ choices: { message: { content: string } }[] }>(
            'https://api.openai.com/v1/chat/completions',
            {
                model: 'gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content: `Translate the following short message to ${targetLabel}. Return ONLY the translation, nothing else. Keep emojis. Preserve any __VAR0__, __VAR1__ etc. placeholders exactly as-is.${maxLenInstruction}`,
                    },
                    { role: 'user', content: sanitized },
                ],
                max_tokens: 100,
                temperature: 0.3,
            },
            {
                headers: {
                    Authorization: `Bearer ${config.openai.apiKey}`,
                    'Content-Type': 'application/json',
                },
                timeout: 10000,
            },
        );

        let translated = response.data.choices[0]?.message?.content?.trim() || '';
        if (!translated) {
            return { en: text, ar: text, sourceLang: effectiveSource, translated: false };
        }

        // Restore template variables
        vars.forEach((v, i) => {
            translated = translated.replace(`__VAR${i}__`, v);
        });

        if (maxLen) {
            translated = translated.slice(0, maxLen);
        }

        const isArabicSource = effectiveSource === 'ar';
        return {
            en: isArabicSource ? translated : text,
            ar: isArabicSource ? text : translated,
            sourceLang: effectiveSource,
            translated: true,
        };
    } catch {
        return { en: text, ar: text, sourceLang: effectiveSource, translated: false };
    }
}

/**
 * Auto-translate a { en?, ar? } translations object.
 *
 * Logic:
 * - Both exist and different → skip (user manually entered both)
 * - Both exist and identical → translate the other
 * - Only one exists → translate to the other
 * - Empty/failure → return original unchanged
 */
export async function autoTranslateTranslations(
    translations: Record<string, string>,
    options?: { maxLength?: number },
): Promise<Record<string, string>> {
    if (!translations) return translations;

    const en = translations.en?.trim() || '';
    const ar = translations.ar?.trim() || '';

    // Nothing to translate
    if (!en && !ar) return translations;

    // Both exist and are different → user manually provided both, skip
    if (en && ar && en !== ar) return translations;

    // Determine which text to translate
    const sourceText = en || ar;

    try {
        const result = await translateText(sourceText, options);
        if (result.translated) {
            return { ...translations, en: result.en, ar: result.ar };
        }
    } catch {
        // Graceful degradation — return original
    }

    return translations;
}
