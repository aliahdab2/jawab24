/**
 * Shared multilingual-settings helpers.
 *
 * Every multilingual settings field (greeting, away message, limit-reached
 * fallback, dual-reply nudge, brand voice) is stored as a `{ ar, en, sourceLang }`
 * JSONB object and uses the SAME smart auto-translation behavior on save:
 *   - edit one language → machine-translate the other(s)
 *   - edit both, or a hand-authored translation → mark `sourceLang: 'manual'`
 *     and never overwrite hand-written content
 *   - clear the source language → reset all to defaults
 *
 * This module is the single home for that logic so the controller (and tests)
 * don't duplicate it per field. Translation + logging are injected so this
 * module stays free of HTTP/AI-service coupling.
 */

/**
 * Coerce a multilingual JSONB value to a plain object.
 *
 * Re-exported from `@jawab24/shared` (one body, not two): the double-encoded-row
 * problem it solves is not backend-specific — the reply pipeline, the support
 * console and the eval all read these columns, and a second copy here is how the
 * two halves drift. The reason it must exist at all: some rows store these
 * columns double-encoded (a JSON *string* inside the jsonb cell), so the driver
 * hands back a string instead of an object. Indexing a string by language
 * (`multi['ar']`) silently yields `undefined`, which breaks the change-detection
 * below — a re-sent, unchanged language reads as "changed" → tips into the
 * no-translate "manual" branch → the other language never re-translates.
 */
import { coerceMultiLang } from '@jawab24/shared';
export { coerceMultiLang };

export interface SmartTranslateOptions {
    /** Languages this user supports, e.g. ['ar', 'en']. */
    supportedLanguages: string[];
    /** Default per-language text restored when the source language is cleared. */
    defaults?: Record<string, string>;
    /**
     * Optional per-language cap. When set, machine translations are clamped to it.
     * A translation can expand past its source (notably AR→EN); for a field whose
     * schema caps each language (e.g. brandVoiceNotesMulti), an over-cap value
     * silently stored here later fails the settings-save validation when the diff
     * resends the whole multilingual object — blocking ALL future saves. Clamping
     * at the source keeps every stored language within the cap by construction.
     */
    maxLength?: number;
    /** Inject the actual translation call (kept out of this module). */
    translate: (text: string, sourceLanguage: 'ar' | 'en', targetLanguage: 'ar' | 'en') => Promise<string>;
    /** Optional failure hook (logging). Translation failures are swallowed so a save never fails. */
    onError?: (info: { fieldName: string; sourceLang: string; targetLang: string; error: unknown }) => void;
}

/**
 * Smart auto-translation for one multilingual field. Returns the new
 * `{ ...langs, sourceLang }` object to persist. Pure given its inputs +
 * injected `translate`, so it's unit-testable without HTTP or the AI worker.
 */
export async function smartTranslateMultiLang(
    updateMulti: Record<string, string> | undefined | null,
    currentMulti: Record<string, string> | undefined | null,
    fieldName: string,
    opts: SmartTranslateOptions,
): Promise<Record<string, string>> {
    const { supportedLanguages, defaults, maxLength, translate, onError } = opts;

    if (!updateMulti) return coerceMultiLang(currentMulti);

    const current = coerceMultiLang(currentMulti);
    const result = { ...current, ...updateMulti };

    // Which content languages actually changed vs the stored value.
    const contentKeys = supportedLanguages;
    const changedKeys = contentKeys.filter(lang =>
        updateMulti[lang] !== undefined && updateMulti[lang] !== current[lang]
    );

    if (changedKeys.length === 0) return result; // No content changes

    // > 1 language changed at once → treat as manually authored; don't overwrite either.
    if (changedKeys.length > 1) {
        result.sourceLang = 'manual';
        return result;
    }

    const sourceLang = changedKeys[0];
    const sourceText = result[sourceLang];

    // --- Field cleared ---
    // Source language cleared → reset ALL languages to defaults (derived
    // translations no longer make sense). A non-source language cleared →
    // only that one is emptied; keep sourceLang pointed at remaining content.
    if (!sourceText) {
        const currentSourceLang = current.sourceLang;
        if (currentSourceLang === sourceLang) {
            for (const lang of contentKeys) {
                result[lang] = defaults?.[lang] || '';
            }
            result.sourceLang = 'default';
        } else {
            const remainingManual = contentKeys.find(l => l !== sourceLang && result[l]);
            result.sourceLang = remainingManual || currentSourceLang || sourceLang;
        }
        return result;
    }

    result.sourceLang = sourceLang;

    // Translate the source into every other supported language.
    for (const targetLang of supportedLanguages) {
        if (targetLang === sourceLang) continue;

        const isTargetEmpty = !result[targetLang];
        // Frontend forms typically only send the field the user edited.
        const isTargetUnchanged = updateMulti[targetLang] === undefined || updateMulti[targetLang] === current[targetLang];

        // Preserve hand-authored translations: the target was manually written
        // when it was the previous source (current.sourceLang === targetLang) or
        // both languages were edited (current.sourceLang === 'manual'). Don't
        // clobber it; mark manual so future edits also preserve both.
        const wasPreviouslyManual =
            current.sourceLang === targetLang || current.sourceLang === 'manual';
        if (wasPreviouslyManual && !isTargetEmpty) {
            result.sourceLang = 'manual';
            continue;
        }

        if (isTargetEmpty || isTargetUnchanged) {
            try {
                const translated = await translate(sourceText, sourceLang as 'ar' | 'en', targetLang as 'ar' | 'en');
                // Clamp to the field cap — a translation can expand past its source
                // (notably AR→EN), and an over-cap value stored here later blocks the
                // whole settings save (see maxLength docs above). No-op when unset.
                result[targetLang] = maxLength ? translated.slice(0, maxLength) : translated;
            } catch (error) {
                onError?.({ fieldName, sourceLang, targetLang, error });
            }
        }
    }

    return result;
}
