import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SettingsSection } from '@/components/admin/customer/SettingsSection';
import type { CustomerDetail } from '@/components/admin/customer/types';

// Render the key so assertions stay independent of the copy (project rule:
// tests never hardcode translated strings).
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));

// Regression: the persona card printed the legacy `brandVoiceNotes` column
// first (an en-preferring sync of the jsonb) and then every differing variant —
// so an Arabic-authoring merchant's persona appeared in English first AND in
// Arabic again. Support must see the merchant-AUTHORED text, once.
function makeCustomer(
  settingsValues: Record<string, unknown>,
  source: 'effective' | 'legacy-fallback' = 'effective',
  pages?: Array<Record<string, unknown>>,
): CustomerDetail {
  return {
    health: [],
    // Deliberately left UNDEFINED unless a case supplies pages: the card must
    // render for a team-member-only account that owns none.
    ...(pages ? { pages } : {}),
    settings: {
      source,
      values: { replyStyle: 'professional', ...settingsValues },
      nonDefaultKeys: [],
    },
  } as unknown as CustomerDetail;
}

describe('SettingsSection — persona shows the merchant-authored language only', () => {
  it('shows the authored Arabic text and never the machine translation or the legacy en-preferring column', () => {
    render(<SettingsSection customer={makeCustomer({
      brandVoiceNotes: 'English machine translation',
      brandVoiceNotesMulti: { ar: 'نص الشخصية العربي', en: 'English machine translation', sourceLang: 'ar' },
    })} />);

    expect(screen.getByText('نص الشخصية العربي')).toBeInTheDocument();
    expect(screen.queryByText('English machine translation')).not.toBeInTheDocument();
    expect(screen.getByText(/customer\.personaSourceLang/)).toBeInTheDocument();
  });

  it('notes that machine translations exist without printing them', () => {
    render(<SettingsSection customer={makeCustomer({
      brandVoiceNotesMulti: { ar: 'نص عربي', en: 'English translation', sourceLang: 'ar' },
    })} />);

    expect(screen.getByText(/customer\.personaAutoTranslatedTo/)).toBeInTheDocument();
    expect(screen.queryByText('English translation')).not.toBeInTheDocument();
  });

  it('shows every variant when both were hand-written (sourceLang manual)', () => {
    render(<SettingsSection customer={makeCustomer({
      brandVoiceNotesMulti: { ar: 'نص عربي مكتوب يدويًا', en: 'Hand-written English', sourceLang: 'manual' },
    })} />);

    expect(screen.getByText('نص عربي مكتوب يدويًا')).toBeInTheDocument();
    expect(screen.getByText('Hand-written English')).toBeInTheDocument();
  });

  it('falls back to the legacy column for rows predating the multilingual jsonb', () => {
    render(<SettingsSection customer={makeCustomer({
      brandVoiceNotes: 'Legacy-only persona text',
      brandVoiceNotesMulti: {},
    })} />);

    expect(screen.getByText('Legacy-only persona text')).toBeInTheDocument();
  });

  it('shows the empty state when nothing is set anywhere', () => {
    render(<SettingsSection customer={makeCustomer({ brandVoiceNotes: '', brandVoiceNotesMulti: {} })} />);

    expect(screen.getByText('customer.personaEmpty')).toBeInTheDocument();
  });
});

describe('SettingsSection — a page persona pin makes this card non-authoritative', () => {
  // The workspace persona shown here reaches NONE of a pinned page's customers:
  // resolveBrandVoiceNotes resolves inside the page override with no workspace
  // fallback. Presenting it as fleet truth is D-087's reply-mode trap one field
  // over — wrong for exactly the pages someone deliberately configured.
  const workspacePersona = { brandVoiceNotesMulti: { ar: 'شخصية مساحة العمل', sourceLang: 'ar' } };

  it('names the pinned pages when one overrides the workspace persona', () => {
    render(<SettingsSection customer={makeCustomer(workspacePersona, 'effective', [
      { id: 'p1', name: 'منتجع شاهين', brandVoiceNotesMulti: { ar: 'لهجة شامية' } },
      { id: 'p2', name: 'عالم شاهين', brandVoiceNotesMulti: null },
    ])} />);

    expect(screen.getByText(/customer\.personaPageOverrideNote/)).toBeInTheDocument();
  });

  it('stays silent when every page inherits', () => {
    render(<SettingsSection customer={makeCustomer(workspacePersona, 'effective', [
      { id: 'p1', name: 'عالم شاهين', brandVoiceNotesMulti: null },
      { id: 'p2', name: 'صفحة أخرى', brandVoiceNotesMulti: {} },
    ])} />);

    expect(screen.queryByText(/customer\.personaPageOverrideNote/)).not.toBeInTheDocument();
  });

  it('does not treat a sourceLang-only or whitespace-only page record as a pin', () => {
    render(<SettingsSection customer={makeCustomer(workspacePersona, 'effective', [
      { id: 'p1', name: 'صفحة', brandVoiceNotesMulti: { sourceLang: 'ar', ar: '   ' } },
    ])} />);

    expect(screen.queryByText(/customer\.personaPageOverrideNote/)).not.toBeInTheDocument();
  });
});

describe('SettingsSection — legacy-fallback warning', () => {
  // When the backend could not overlay the workspace store, the values shown
  // are the raw legacy row — the state that once reported 30 silent merchants
  // as healthy. The degradation must be visible, never silent.
  it('renders the warning banner when settings.source is legacy-fallback', () => {
    render(<SettingsSection customer={makeCustomer({}, 'legacy-fallback')} />);

    expect(screen.getByRole('alert')).toHaveTextContent('customer.settingsLegacyFallbackWarn');
  });

  it('renders no banner for effective settings', () => {
    render(<SettingsSection customer={makeCustomer({})} />);

    expect(screen.queryByText('customer.settingsLegacyFallbackWarn')).not.toBeInTheDocument();
  });
});
