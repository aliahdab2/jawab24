import { useLocale } from 'next-intl';

/**
 * Binds one multilingual settings field (a jsonb of per-language texts plus a
 * `sourceLang` metadata key, e.g. `{ ar, en, sourceLang }` today — designed to
 * grow beyond that pair) to the language of the PAGE the merchant is looking at.
 *
 * `currentLang` is the next-intl locale, NOT `settings.dashboardLanguage`: the
 * two drift (header language toggle, direct /en|/ar URLs), and keying content
 * off dashboardLanguage rendered English merchant content on an Arabic page and
 * wrote edits into the wrong language key. All settings cards must read and
 * write multilingual fields through this hook so that can't recur.
 *
 * `sourceLang` semantics (set by the backend's smartTranslateMultiLang):
 * a language code = the merchant authored that variant and the others are
 * machine translations; 'manual' = every language is hand-written;
 * 'default' = system defaults after the field was cleared.
 */
export function useMultilingualSettingsField(multi: Record<string, string> | undefined) {
    const currentLang = useLocale();
    const value = multi?.[currentLang] || '';
    const sourceLang = multi?.sourceLang;
    const isAutoTranslated = !!(sourceLang && sourceLang !== 'manual' && sourceLang !== currentLang);

    /** The field object to persist after the merchant edits the current-language variant. */
    const withValue = (next: string): Record<string, string> => ({
        ...multi,
        [currentLang]: next,
        sourceLang: currentLang,
    });

    /** True when ANY language variant has content (sourceLang is metadata, not content). */
    const hasAnyContent = Object.entries(multi || {})
        .some(([k, v]) => k !== 'sourceLang' && typeof v === 'string' && v.trim().length > 0);

    return { currentLang, value, sourceLang, isAutoTranslated, hasAnyContent, withValue };
}
