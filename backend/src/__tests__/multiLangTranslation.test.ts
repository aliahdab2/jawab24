/**
 * Tests for smart multilingual auto-translation on settings save.
 *
 * Invariant under test (the one that bit production): a machine translation can
 * expand past its source — AR→EN especially. For a field whose schema caps each
 * language (brandVoiceNotesMulti, capped at MAX_BRAND_VOICE_LENGTH), an over-cap
 * value stored here later fails the settings-save validation when the diff resends
 * the whole multilingual object, silently blocking ALL future saves. The fix
 * clamps the translation at the source via the `maxLength` option, so an over-cap
 * value can never be stored. These tests lock that in so it can't regress.
 */
import { describe, it, expect, vi } from 'vitest';
import { MAX_BRAND_VOICE_LENGTH } from '@jawab24/shared';
import { smartTranslateMultiLang } from '../services/multiLangTranslation';

describe('smartTranslateMultiLang — maxLength clamp', () => {
  it('clamps a machine translation that exceeds maxLength (prevents the over-cap trap)', async () => {
    // User edits Arabic; the English machine translation comes back longer than the cap.
    const translate = vi.fn().mockResolvedValue('e'.repeat(MAX_BRAND_VOICE_LENGTH + 250));

    const result = await smartTranslateMultiLang(
      { ar: 'تعليمات الرد' },
      {},
      'brandVoiceNotes',
      { supportedLanguages: ['ar', 'en'], maxLength: MAX_BRAND_VOICE_LENGTH, translate },
    );

    expect(result.en.length).toBe(MAX_BRAND_VOICE_LENGTH); // clamped — never over cap
    expect(result.ar).toBe('تعليمات الرد'); // source untouched
    expect(result.sourceLang).toBe('ar');
  });

  it('does NOT clamp when maxLength is unset (uncapped fields like away/greeting)', async () => {
    const long = 'e'.repeat(MAX_BRAND_VOICE_LENGTH + 250);
    const translate = vi.fn().mockResolvedValue(long);

    const result = await smartTranslateMultiLang(
      { ar: 'رسالة الغياب' },
      {},
      'awayMessage',
      { supportedLanguages: ['ar', 'en'], translate },
    );

    expect(result.en).toBe(long); // full translation preserved
  });

  it('leaves a translation already within the cap unchanged', async () => {
    const translate = vi.fn().mockResolvedValue('short translation');

    const result = await smartTranslateMultiLang(
      { ar: 'مرحبا' },
      {},
      'brandVoiceNotes',
      { supportedLanguages: ['ar', 'en'], maxLength: MAX_BRAND_VOICE_LENGTH, translate },
    );

    expect(result.en).toBe('short translation');
  });
});
