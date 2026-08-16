import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MAX_BRAND_VOICE_LENGTH } from '@jawab24/shared';
import { ReplyStyleCard } from '@/components/settings/ReplyStyleCard';
import type { SettingsState } from '@/components/settings/types';

// Mock the lazy-loaded test modal as a probe exposing WHICH page it was opened
// on — the default-target pins below assert the card's page selection without
// rendering the real modal.
vi.mock('next/dynamic', () => ({
  default: () => (props: { page?: { name?: string } }) => (
    <div data-testid="test-modal">{props.page?.name}</div>
  ),
}));

vi.mock('@/lib/api', () => ({
  pagesApi: {
    getAll: vi.fn(),
    updateBrandVoice: vi.fn(),
  },
}));

vi.mock('@/components/ui', () => import('../../testUtils/uiMocks'));

// next-intl mock from setup.ts handles `useTranslations` automatically with real EN strings.

import { pagesApi } from '@/lib/api';
import { makeSettings } from '../../testUtils/settingsFactory';
import { intlState } from '../../testUtils/intlState';

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
    // The why lives in the tooltip only — no standalone visible line next to
    // the button (owner call, 2026-08-16); the textarea hint carries it.
    expect(btn).toHaveAttribute('title', expect.stringMatching(/Save your changes first/i));
  });

  it('test button is enabled when there are no unsaved changes', () => {
    const current = makeSettings();
    render(<ReplyStyleCard settings={current} setSettings={vi.fn()} hasChanges={false} />);

    const btn = screen.getByRole('button', { name: /Test with the AI/i });
    expect(btn).not.toBeDisabled();
  });

  // The separate «Testing on» label + picker was removed entirely (owner call,
  // 2026-08-16): the persona scope switcher is the ONE page selector and the
  // test follows it (scopedPage ?? first connected page). The first-connected
  // default still lives in the component (selectedPage) and feeds the modal —
  // the two pins below re-assert it through the modal probe, replacing the
  // picker-based originals (regression: `fetched[0]` used to default the test
  // to whatever page was created last, often a stale/disconnected one).

  it('test defaults to the first CONNECTED page, not the most-recent disconnected one', async () => {
    vi.mocked(pagesApi.getAll).mockResolvedValueOnce({
      data: [
        { id: 'p2', name: 'New Disconnected Page', isConnected: false },
        { id: 'p1', name: 'Connected Page', isConnected: true },
      ],
    } as never);

    render(<ReplyStyleCard settings={makeSettings()} setSettings={vi.fn()} hasChanges={false} />);
    await waitFor(() => expect(pagesApi.getAll).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /Test with the AI/i }));
    expect(await screen.findByTestId('test-modal')).toHaveTextContent('Connected Page');
  });

  it('test falls back to the first page when none are connected', async () => {
    vi.mocked(pagesApi.getAll).mockResolvedValueOnce({
      data: [
        { id: 'p2', name: 'Disconnected A', isConnected: false },
        { id: 'p1', name: 'Disconnected B', isConnected: false },
      ],
    } as never);

    render(<ReplyStyleCard settings={makeSettings()} setSettings={vi.fn()} hasChanges={false} />);
    await waitFor(() => expect(pagesApi.getAll).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /Test with the AI/i }));
    expect(await screen.findByTestId('test-modal')).toHaveTextContent('Disconnected A');
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

  // ── Per-page persona scope (D-084) ──────────────────────────────────────
  describe('persona scope switcher', () => {
    const TWO_PAGES = [
      { id: 'p1', name: 'Resort Page', isConnected: true, brandVoiceNotesMulti: null },
      { id: 'p2', name: 'Fashion Page', isConnected: true, brandVoiceNotesMulti: { ar: 'شخصية الصفحة', sourceLang: 'manual' } },
    ];

    it('renders only for multi-page workspaces', async () => {
      vi.mocked(pagesApi.getAll).mockResolvedValueOnce({
        data: [{ id: 'p1', name: 'Only Page', isConnected: true }],
      } as never);
      const { rerender } = render(<ReplyStyleCard settings={makeSettings()} setSettings={vi.fn()} />);
      await waitFor(() => expect(pagesApi.getAll).toHaveBeenCalled());
      expect(screen.queryByText(/Editing persona for/i)).not.toBeInTheDocument();

      vi.mocked(pagesApi.getAll).mockResolvedValueOnce({ data: TWO_PAGES } as never);
      rerender(<ReplyStyleCard key="two" settings={makeSettings()} setSettings={vi.fn()} />);
      expect(await screen.findByText(/Editing persona for/i)).toBeInTheDocument();
    });

    it('page scope shows the editor directly; save is the fork point and PATCHes the page', async () => {
      vi.mocked(pagesApi.getAll).mockResolvedValueOnce({ data: TWO_PAGES } as never);
      vi.mocked(pagesApi.updateBrandVoice).mockResolvedValue({
        data: { ...TWO_PAGES[0], brandVoiceNotesMulti: { en: 'Info desk only', sourceLang: 'en' } },
      } as never);

      render(<ReplyStyleCard settings={makeSettings()} setSettings={vi.fn()} />);
      await screen.findByText(/Editing persona for/i);

      const scopeSelect = screen.getAllByRole('combobox')[0] as HTMLSelectElement;
      fireEvent.change(scopeSelect, { target: { value: 'p1' } });

      expect(screen.getAllByText(/Uses the general persona/i).length).toBeGreaterThan(0);
      // No «customize» step (owner call, 2026-08-16): the editor is immediate,
      // and the SAVE button — disabled until the draft differs — is the fork.
      const saveBtn = screen.getByRole('button', { name: /Save page persona/i });
      expect(saveBtn).toBeDisabled();

      const textarea = screen.getByRole('textbox', { name: /Persona for Resort Page/i });
      fireEvent.change(textarea, { target: { value: 'Info desk only' } });
      expect(saveBtn).not.toBeDisabled();
      fireEvent.click(saveBtn);

      await waitFor(() => {
        // Sends ONLY the current language — backend auto-translates the rest.
        expect(pagesApi.updateBrandVoice).toHaveBeenCalledWith('p1', { en: 'Info desk only' });
      });
      expect((await screen.findAllByText(/Has its own persona/i)).length).toBeGreaterThan(0);
    });

    it('a page with an override shows the custom chip; revert PATCHes null', async () => {
      vi.mocked(pagesApi.getAll).mockResolvedValueOnce({ data: TWO_PAGES } as never);
      vi.mocked(pagesApi.updateBrandVoice).mockResolvedValue({
        data: { ...TWO_PAGES[1], brandVoiceNotesMulti: null },
      } as never);

      render(<ReplyStyleCard settings={makeSettings()} setSettings={vi.fn()} />);
      await screen.findByText(/Editing persona for/i);

      const scopeSelect = screen.getAllByRole('combobox')[0] as HTMLSelectElement;
      fireEvent.change(scopeSelect, { target: { value: 'p2' } });

      expect(screen.getAllByText(/Has its own persona/i).length).toBeGreaterThan(0);
      expect(screen.getByDisplayValue('شخصية الصفحة')).toBeInTheDocument();

      // Revert is destructive — it must pass through the confirmation modal,
      // never fire on the first click.
      fireEvent.click(screen.getByRole('button', { name: /Revert to default/i }));
      expect(pagesApi.updateBrandVoice).not.toHaveBeenCalled();
      fireEvent.click(screen.getByTestId('confirm-modal-confirm'));
      await waitFor(() => {
        expect(pagesApi.updateBrandVoice).toHaveBeenCalledWith('p2', null);
      });
      expect((await screen.findAllByText(/Uses the general persona/i)).length).toBeGreaterThan(0);
      // Explicit success signal for the revert.
      expect(await screen.findByText(/Reverted to the general persona/i)).toBeInTheDocument();
    });

    it('an inheriting page seeds its editor from the SAVED workspace persona, never the unsaved draft', async () => {
      vi.mocked(pagesApi.getAll).mockResolvedValueOnce({ data: TWO_PAGES } as never);
      // The live settings draft is DIRTY (hasChanges): the page editor must
      // show what the page actually inherits — the persisted text.
      const dirty = makeSettings({ brandVoiceNotesMulti: { en: 'UNSAVED draft text', sourceLang: 'en' } });
      render(
        <ReplyStyleCard
          settings={dirty}
          setSettings={vi.fn()}
          hasChanges
          savedBrandVoiceNotesMulti={{ en: 'Saved workspace persona', sourceLang: 'en' }}
        />,
      );
      await screen.findByText(/Editing persona for/i);

      const scopeSelect = screen.getAllByRole('combobox')[0] as HTMLSelectElement;
      fireEvent.change(scopeSelect, { target: { value: 'p1' } });

      expect(screen.getByRole('textbox', { name: /Persona for Resort Page/i })).toHaveValue('Saved workspace persona');
    });

    it('a disconnected page WITH an override stays in the switcher (visible and revertable)', async () => {
      vi.mocked(pagesApi.getAll).mockResolvedValueOnce({
        data: [
          { id: 'p1', name: 'Live Page', isConnected: true, brandVoiceNotesMulti: null },
          // Token revoked, override still on the row — hiding it would orphan
          // the persona: invisible in the UI, still winning after a reconnect.
          { id: 'p3', name: 'Dead Page', isConnected: false, brandVoiceNotesMulti: { ar: 'شخصية قديمة', sourceLang: 'manual' } },
        ],
      } as never);
      render(<ReplyStyleCard settings={makeSettings()} setSettings={vi.fn()} />);
      await screen.findByText(/Editing persona for/i);

      const scopeSelect = screen.getAllByRole('combobox')[0] as HTMLSelectElement;
      fireEvent.change(scopeSelect, { target: { value: 'p3' } });

      expect(screen.getByDisplayValue('شخصية قديمة')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Revert to default/i })).toBeEnabled();
    });

    it('flipping the editing language reseeds the draft — a save never writes the OLD language text under the NEW key', async () => {
      vi.mocked(pagesApi.getAll).mockResolvedValueOnce({ data: TWO_PAGES } as never);
      const settings = makeSettings({ brandVoiceNotesMulti: { en: 'English workspace persona', ar: 'شخصية عربية', sourceLang: 'manual' } });
      const { rerender } = render(
        <ReplyStyleCard settings={settings} setSettings={vi.fn()} savedBrandVoiceNotesMulti={settings.brandVoiceNotesMulti} />,
      );
      await screen.findByText(/Editing persona for/i);

      fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'p1' } });
      expect(screen.getByRole('textbox', { name: /Persona for Resort Page/i })).toHaveValue('English workspace persona');

      // Merchant flips the dashboard locale mid-scope. The draft must follow —
      // keeping the English text would save it under the Arabic key.
      intlState.locale = 'ar';
      rerender(<ReplyStyleCard settings={settings} setSettings={vi.fn()} savedBrandVoiceNotesMulti={settings.brandVoiceNotesMulti} />);
      expect(screen.getByRole('textbox', { name: /Persona for Resort Page/i })).toHaveValue('شخصية عربية');
    });

    it('save shows an explicit success notice', async () => {
      vi.mocked(pagesApi.getAll).mockResolvedValueOnce({ data: TWO_PAGES } as never);
      vi.mocked(pagesApi.updateBrandVoice).mockResolvedValue({
        data: { ...TWO_PAGES[0], brandVoiceNotesMulti: { en: 'Info desk only', sourceLang: 'en' } },
      } as never);
      render(<ReplyStyleCard settings={makeSettings()} setSettings={vi.fn()} />);
      await screen.findByText(/Editing persona for/i);

      fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'p1' } });
      fireEvent.change(screen.getByRole('textbox', { name: /Persona for Resort Page/i }), { target: { value: 'Info desk only' } });
      fireEvent.click(screen.getByRole('button', { name: /Save page persona/i }));

      expect(await screen.findByText(/Page persona saved/i)).toBeInTheDocument();
    });

    it('never renders a separate «Testing on» row — the scope switcher is the one selector', async () => {
      // A second picker could let the merchant test on a DIFFERENT page than
      // the persona they just wrote and see no effect (owner call, 2026-08-16).
      vi.mocked(pagesApi.getAll).mockResolvedValueOnce({ data: TWO_PAGES } as never);
      render(<ReplyStyleCard settings={makeSettings()} setSettings={vi.fn()} hasChanges={false} />);
      await screen.findByText(/Editing persona for/i);
      expect(screen.queryByText(/Testing on/i)).not.toBeInTheDocument();

      const scopeSelect = screen.getAllByRole('combobox')[0] as HTMLSelectElement;
      fireEvent.change(scopeSelect, { target: { value: 'p1' } });
      expect(screen.queryByText(/Testing on/i)).not.toBeInTheDocument();
      // Exactly one combobox exists — the scope switcher itself.
      expect(screen.getAllByRole('combobox')).toHaveLength(1);
    });
  });
});
