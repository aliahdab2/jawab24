/**
 * Centralized backend i18n for customer-facing strings.
 *
 * Translations live in JSON files at `backend/src/i18n/<locale>.json`,
 * one file per locale, keyed by message ID. English is the source of truth
 * for the key set; other locales are type-checked against it at compile time.
 *
 * To add a new language: create `backend/src/i18n/<locale>.json` with every
 * key from `en.json`, then add the locale to the `Locale` union and the
 * `messages` table below. TypeScript will fail the build if any key is missing.
 *
 * To add a new key: add it to every locale file. The `MessageKey` type is
 * derived from `en.json`, so referencing a missing key in `t(...)` is a
 * compile error.
 */

import en from '../i18n/en.json';
import ar from '../i18n/ar.json';

type Locale = 'ar' | 'en';
export type MessageKey = keyof typeof en;

// Asserting `typeof en` ensures every locale has the exact same key set.
// Adding a key to en.json without adding it to ar.json is a compile error.
const messages: Record<Locale, Record<MessageKey, string>> = {
    en,
    ar: ar satisfies typeof en,
};

/**
 * Get a customer-facing string by key and locale.
 * Falls back to English if the locale is not found.
 * Optional `vars` replaces `{key}` placeholders in the string.
 */
export function t(key: MessageKey, lang: string, vars?: Record<string, string>): string {
    const locale = (lang === 'ar' ? 'ar' : 'en') as Locale;
    let text: string = messages[locale][key] ?? messages.en[key];
    if (vars) {
        for (const [k, v] of Object.entries(vars)) {
            text = text.replaceAll(`{${k}}`, v);
        }
    }
    return text;
}
