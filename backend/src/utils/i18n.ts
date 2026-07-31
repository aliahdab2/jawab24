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

export type Locale = 'ar' | 'en';
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
    // Resolve against the `messages` table rather than testing for 'ar' explicitly.
    // The old form (`lang === 'ar' ? 'ar' : 'en'`) silently collapsed EVERY other
    // locale to English, so adding a language to the `Locale` union — which the
    // header above promises is enough — would have compiled, type-checked, and
    // still shipped English to those customers. Behaviour is identical for the
    // current ar/en pair; this makes the third language work by construction.
    const locale = (Object.prototype.hasOwnProperty.call(messages, lang) ? lang : 'en') as Locale;
    let text: string = messages[locale][key] ?? messages.en[key];
    if (vars) {
        for (const [k, v] of Object.entries(vars)) {
            // Use a replacer FUNCTION, not a replacement string: String.replaceAll
            // interprets `$&`, `$\``, `$'`, `$$` etc. in a replacement string, which
            // would corrupt any value containing `$` (e.g. a workspace/business name
            // like "Acme $& Co"). A function inserts the value literally.
            text = text.replaceAll(`{${k}}`, () => v);
        }
    }
    return text;
}

/**
 * Default locale for merchant-facing surfaces when no preference is stored —
 * matches the `settings.dashboard_language` column default.
 */
export const DEFAULT_LOCALE: Locale = 'ar';

/**
 * Narrow a stored `settings.dashboard_language` value to a supported locale.
 *
 * Resolved against the `messages` table for the same reason `t()` is (see the
 * comment there): the hand-written form this replaces — `lang === 'en' ? 'en'
 * : 'ar'` — silently collapses every *other* locale to Arabic, so adding a
 * third language to the `Locale` union would type-check and still ship Arabic
 * to those merchants. Call sites that need an email/template locale should use
 * this instead of re-deriving it.
 */
export function resolveLocale(value: string | null | undefined): Locale {
    return value && Object.prototype.hasOwnProperty.call(messages, value)
        ? (value as Locale)
        : DEFAULT_LOCALE;
}
