import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import enSettings from '@/i18n/en/settings.json';
import { ReplyStyleCard } from '@/components/settings/ReplyStyleCard';
import { LimitFallbackMessageCard } from '@/components/settings/LimitFallbackMessageCard';
import { makeSettings } from '../../testUtils/settingsFactory';
import { intlState } from '../../testUtils/intlState';

// Regression: the multilingual settings cards must display/edit the variant of
// the PAGE language (next-intl locale), never settings.dashboardLanguage. The
// two drift (header language toggle, direct /en|/ar URLs), and keying content
// off dashboardLanguage rendered English merchant content on an Arabic page and
// wrote edits into the wrong language key.

vi.mock('next/dynamic', () => ({
  default: () => () => null,
}));

vi.mock('@/lib/api', () => ({
  pagesApi: {
    getAll: vi.fn().mockResolvedValue({ data: [] }),
  },
}));

vi.mock('@/components/ui', () => import('../../testUtils/uiMocks'));

describe('settings cards follow the page locale, not dashboardLanguage', () => {
  it('ReplyStyleCard shows the Arabic persona on an Arabic page even when dashboardLanguage is stale ("en")', () => {
    intlState.locale = 'ar';
    const settings = makeSettings({
      dashboardLanguage: 'en',
      brandVoiceNotesMulti: { ar: 'نص الشخصية العربي', en: 'English persona text', sourceLang: 'manual' },
    });

    render(<ReplyStyleCard settings={settings} setSettings={vi.fn()} />);

    expect(screen.getByRole('textbox')).toHaveValue('نص الشخصية العربي');
  });

  it('ReplyStyleCard writes edits into the page-locale key, leaving the other language untouched', () => {
    intlState.locale = 'ar';
    const setSettings = vi.fn();
    const settings = makeSettings({
      dashboardLanguage: 'en',
      brandVoiceNotesMulti: { ar: 'قديم', en: 'English persona text', sourceLang: 'manual' },
    });

    render(<ReplyStyleCard settings={settings} setSettings={setSettings} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'جديد' } });

    expect(setSettings).toHaveBeenCalledWith(expect.objectContaining({
      brandVoiceNotesMulti: { ar: 'جديد', en: 'English persona text', sourceLang: 'ar' },
    }));
  });

  it('ReplyStyleCard inserts the persona template into the page-locale key, not the stale dashboardLanguage', () => {
    // Page is English, stored dashboardLanguage says Arabic. The template text
    // comes from the page-locale t(), so it MUST land under the page-locale key —
    // the old dashboardLanguage keying stored an English template under the
    // merchant's Arabic persona, which then surfaced on a fully-Arabic page.
    const setSettings = vi.fn();
    const settings = makeSettings({ dashboardLanguage: 'ar', brandVoiceNotesMulti: {} });

    render(<ReplyStyleCard settings={settings} setSettings={setSettings} />);
    fireEvent.click(screen.getByText(enSettings.replyStyle.templateLabel));

    expect(setSettings).toHaveBeenCalledWith(expect.objectContaining({
      brandVoiceNotesMulti: expect.objectContaining({
        en: enSettings.replyStyle.exampleTemplate,
        sourceLang: 'en',
      }),
    }));
  });

  it('LimitFallbackMessageCard shows the Arabic fallback reply on an Arabic page when dashboardLanguage is stale', () => {
    intlState.locale = 'ar';
    const settings = makeSettings({
      dashboardLanguage: 'en',
      limitFallbackEnabled: true,
      limitFallbackMessageMulti: { ar: 'نعتذر، سنرد قريبًا', en: 'Sorry, we will reply soon', sourceLang: 'manual' },
    });

    render(<LimitFallbackMessageCard settings={settings} setSettings={vi.fn()} />);

    expect(screen.getByRole('textbox')).toHaveValue('نعتذر، سنرد قريبًا');
  });
});
