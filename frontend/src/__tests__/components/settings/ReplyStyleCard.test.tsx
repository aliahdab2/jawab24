import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MAX_BRAND_VOICE_LENGTH } from '@jawab24/shared';
import { ReplyStyleCard } from '@/components/settings/ReplyStyleCard';
import type { SettingsState } from '@/components/settings/types';

// Mock the lazy-loaded test modal — we don't need to render it for the
// settings-card tests, only assert that the trigger button works.
vi.mock('next/dynamic', () => ({
  default: () => () => null,
}));

vi.mock('@/lib/api', () => ({
  pagesApi: {
    getAll: vi.fn(),
  },
}));

vi.mock('@/components/ui', () => ({
  Card: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  Toggle: ({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) => (
    <button data-testid="toggle" onClick={() => onChange(!enabled)}>
      {enabled ? 'ON' : 'OFF'}
    </button>
  ),
  InputFieldWrapper: ({ children, trailing }: { children: React.ReactNode; trailing?: React.ReactNode }) => (
    <div>{children}{trailing}</div>
  ),
  CharCounter: ({ value, max }: { value: string | number; max: number }) => {
    const len = typeof value === 'string' ? value.length : value;
    return <span>{len}/{max}</span>;
  },
}));

// next-intl mock from setup.ts handles `useTranslations` automatically with real EN strings.

import { pagesApi } from '@/lib/api';

function makeSettings(overrides: Partial<SettingsState> = {}): SettingsState {
  return {
    dashboardLanguage: 'en',
    defaultReplyLanguage: 'ar',
    autoDetectLanguage: true,
    aiEnabled: true,
    aiModel: 'gpt-4o-mini',
    notificationsEnabled: false,
    newLeadAlertsEnabled: false,
    pushNotifications: false,
    commentReplyMode: 'dual',
    commentsAutoReply: true,
    messagesAutoReply: true,
    businessHoursOnly: false,
    businessHoursStart: '09:00',
    businessHoursEnd: '17:00',
    timezone: 'UTC',
    awayMessageMulti: {},
    greetingMessageMulti: {},
    dualReplyNudgeMulti: {},
    awayMessage: '',
    greetingMessage: '',
    replyDelay: 0,
    dualReplyNudge: '',
    brandVoiceNotesMulti: {},
    replyStyle: 'professional',
    brandVoiceNotes: '',
    holdLowConfidence: false,
    commentEscalationMinutes: 30,
    messageEscalationMinutes: 30,
    handoffPauseDurationMinutes: 60,
    ...overrides,
  };
}

describe('ReplyStyleCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no pages connected — keeps unrelated tests deterministic.
    vi.mocked(pagesApi.getAll).mockResolvedValue({ data: [] } as never);
  });

  it('shows the "start from a template" button only when brand voice is empty', () => {
    let current = makeSettings();
    const setSettings = vi.fn((s: SettingsState) => { current = s; });

    const { rerender } = render(<ReplyStyleCard settings={current} setSettings={setSettings} />);

    // Empty: template button visible
    expect(screen.getByRole('button', { name: /Start from a template/i })).toBeInTheDocument();

    // Non-empty: template button hidden
    current = makeSettings({ brandVoiceNotesMulti: { en: 'something', sourceLang: 'en' } });
    rerender(<ReplyStyleCard settings={current} setSettings={setSettings} />);
    expect(screen.queryByRole('button', { name: /Start from a template/i })).not.toBeInTheDocument();
  });

  it('clicking the template button inserts the persona skeleton into the textarea', () => {
    let current = makeSettings();
    const setSettings = vi.fn((s: SettingsState) => { current = s; });

    render(<ReplyStyleCard settings={current} setSettings={setSettings} />);

    fireEvent.click(screen.getByRole('button', { name: /Start from a template/i }));

    // Inserts the generic persona skeleton (replyStyle.exampleTemplate) under the
    // dashboard language, stamping the source language for auto-translation.
    expect(setSettings).toHaveBeenCalledWith(expect.objectContaining({
      brandVoiceNotesMulti: expect.objectContaining({
        en: expect.stringContaining('Name:'),
        sourceLang: 'en',
      }),
    }));
  });

  it('counter renders at 80%+ of MAX_BRAND_VOICE_LENGTH (not a hardcoded 500)', () => {
    // Counter is hidden below the 80% threshold to reduce visual noise; only appears
    // when the merchant is approaching the limit. Test with a value above the threshold.
    const charCount = Math.ceil(MAX_BRAND_VOICE_LENGTH * 0.95);
    const filler = 'x'.repeat(charCount);
    const current = makeSettings({ brandVoiceNotesMulti: { en: filler, sourceLang: 'en' } });
    render(<ReplyStyleCard settings={current} setSettings={vi.fn()} />);

    // The counter shows "<count>/<max>" — proves we use the shared constant, not 500.
    expect(screen.getByText(`${charCount}/${MAX_BRAND_VOICE_LENGTH}`)).toBeInTheDocument();
    expect(MAX_BRAND_VOICE_LENGTH).toBe(800);
  });

  it('clicking a tone radio button changes settings.replyStyle', () => {
    let current = makeSettings();
    const setSettings = vi.fn((s: SettingsState) => { current = s; });
    render(<ReplyStyleCard settings={current} setSettings={setSettings} />);

    const casual = screen.getByRole('radio', { name: /Casual/i });
    fireEvent.click(casual);

    expect(setSettings).toHaveBeenCalledWith(expect.objectContaining({ replyStyle: 'casual' }));
  });

  it('test button is disabled when there are unsaved changes', () => {
    const current = makeSettings();
    render(<ReplyStyleCard settings={current} setSettings={vi.fn()} hasChanges />);

    const btn = screen.getByRole('button', { name: /Test with the AI/i });
    expect(btn).toBeDisabled();
    expect(screen.getByText(/Save settings to test/i)).toBeInTheDocument();
  });

  it('test button is enabled when there are no unsaved changes', () => {
    const current = makeSettings();
    render(<ReplyStyleCard settings={current} setSettings={vi.fn()} hasChanges={false} />);

    const btn = screen.getByRole('button', { name: /Test with the AI/i });
    expect(btn).not.toBeDisabled();
  });

  it('shows "Testing on: <pageName>" once the first page is fetched', async () => {
    vi.mocked(pagesApi.getAll).mockResolvedValueOnce({
      data: [{ id: 'p1', name: 'Acme Riyadh' }],
    } as never);

    const current = makeSettings();
    render(<ReplyStyleCard settings={current} setSettings={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/Testing on: Acme Riyadh/i)).toBeInTheDocument();
    });
  });

  it('defaults the test page to the first CONNECTED page, not the most-recent disconnected one', async () => {
    // Backend returns pages most-recent-first (orderBy createdAt desc). The newest
    // page here is disconnected; the default must skip it and land on the connected
    // one — a disconnected page can't generate a test reply. Regression for the
    // `fetched[0]` default that picked whatever page was created last.
    vi.mocked(pagesApi.getAll).mockResolvedValueOnce({
      data: [
        { id: 'p2', name: 'New Disconnected Page', isConnected: false },
        { id: 'p1', name: 'Connected Page', isConnected: true },
      ],
    } as never);

    const current = makeSettings();
    render(<ReplyStyleCard settings={current} setSettings={vi.fn()} hasChanges={false} />);

    // With more than one page the card renders a page-picker <select>; its value is
    // the defaulted selection. It must be the connected page, not the newest one.
    const select = (await screen.findByRole('combobox')) as HTMLSelectElement;
    expect(select.value).toBe('p1');
  });

  it('falls back to the first page when none are connected', async () => {
    vi.mocked(pagesApi.getAll).mockResolvedValueOnce({
      data: [
        { id: 'p2', name: 'Disconnected A', isConnected: false },
        { id: 'p1', name: 'Disconnected B', isConnected: false },
      ],
    } as never);

    const current = makeSettings();
    render(<ReplyStyleCard settings={current} setSettings={vi.fn()} hasChanges={false} />);

    const select = (await screen.findByRole('combobox')) as HTMLSelectElement;
    expect(select.value).toBe('p2');
  });

  it('shows hold-relocation notice only when holdLowConfidence is on and not yet seen', () => {
    // localStorage clean — notice should appear.
    window.localStorage.removeItem('hold_relocation_seen');

    const current = makeSettings({ holdLowConfidence: true });
    const { rerender } = render(<ReplyStyleCard settings={current} setSettings={vi.fn()} />);

    expect(screen.getByText(/moved to Advanced Settings/i)).toBeInTheDocument();

    // Off: notice hidden.
    const off = makeSettings({ holdLowConfidence: false });
    rerender(<ReplyStyleCard settings={off} setSettings={vi.fn()} />);
    expect(screen.queryByText(/moved to Advanced Settings/i)).not.toBeInTheDocument();

    // localStorage flag set: notice hidden.
    window.localStorage.setItem('hold_relocation_seen', '1');
    const seen = makeSettings({ holdLowConfidence: true });
    rerender(<ReplyStyleCard settings={seen} setSettings={vi.fn()} />);
    expect(screen.queryByText(/moved to Advanced Settings/i)).not.toBeInTheDocument();

    window.localStorage.removeItem('hold_relocation_seen');
  });
});
