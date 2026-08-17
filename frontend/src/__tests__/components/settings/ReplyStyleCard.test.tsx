import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MAX_BRAND_VOICE_LENGTH } from '@jawab24/shared';
import { ReplyStyleCard } from '@/components/settings/ReplyStyleCard';
import type { SettingsState } from '@/components/settings/types';
import enSettings from '@/i18n/en/settings.json';

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
    updateReplyMode: vi.fn(),
  },
}));

// The reply-mode section is workspace-gated (D-085 pilot). The flag fn itself
// is the trivial allowlist pattern; the UI tests control it by workspace id.
vi.mock('@/lib/featureFlags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/featureFlags')>()),
  isReplyModeVisible: (id: string | null | undefined) => id === 'mode-ws',
}));

vi.mock('@/components/ui', () => import('../../testUtils/uiMocks'));

// next-intl mock from setup.ts handles `useTranslations` automatically with real EN strings.

import { pagesApi } from '@/lib/api';
import { makeSettings } from '../../testUtils/settingsFactory';
import { intlState } from '../../testUtils/intlState';

// The page-scope editor's accessible name comes from the SHIPPED string, not a
// copy of it. Five selectors hardcoded «Persona for {page}» and all five broke
// the day the label was reworded — the same drift Rule 10.6 bans in e2e.
const pageEditorName = (page: string) =>
  enSettings.replyStyle.pageBrandVoice.replace('{page}', page);

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

      const textarea = screen.getByRole('textbox', { name: pageEditorName('Resort Page') });
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

      expect(screen.getByRole('textbox', { name: pageEditorName('Resort Page') })).toHaveValue('Saved workspace persona');
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
      expect(screen.getByRole('textbox', { name: pageEditorName('Resort Page') })).toHaveValue('English workspace persona');

      // Merchant flips the dashboard locale mid-scope. The draft must follow —
      // keeping the English text would save it under the Arabic key.
      intlState.locale = 'ar';
      rerender(<ReplyStyleCard settings={settings} setSettings={vi.fn()} savedBrandVoiceNotesMulti={settings.brandVoiceNotesMulti} />);
      expect(screen.getByRole('textbox', { name: pageEditorName('Resort Page') })).toHaveValue('شخصية عربية');
    });

    it('save shows an explicit success notice', async () => {
      vi.mocked(pagesApi.getAll).mockResolvedValueOnce({ data: TWO_PAGES } as never);
      vi.mocked(pagesApi.updateBrandVoice).mockResolvedValue({
        data: { ...TWO_PAGES[0], brandVoiceNotesMulti: { en: 'Info desk only', sourceLang: 'en' } },
      } as never);
      render(<ReplyStyleCard settings={makeSettings()} setSettings={vi.fn()} />);
      await screen.findByText(/Editing persona for/i);

      fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'p1' } });
      fireEvent.change(screen.getByRole('textbox', { name: pageEditorName('Resort Page') }), { target: { value: 'Info desk only' } });
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

  // ── Reply mode (D-085) ────────────────────────────────────────────────────
  describe('reply-mode section', () => {
    const TWO_PAGES = [
      { id: 'p1', name: 'Resort Page', isConnected: true, brandVoiceNotesMulti: null, replyMode: null },
      { id: 'p2', name: 'Fashion Page', isConnected: true, brandVoiceNotesMulti: null, replyMode: null },
    ];
    const QUESTION = /What should the assistant do when a customer wants to buy or book/i;

    it('renders nothing for a workspace outside the pilot allowlist', async () => {
      vi.mocked(pagesApi.getAll).mockResolvedValueOnce({ data: TWO_PAGES } as never);
      render(<ReplyStyleCard settings={makeSettings()} setSettings={vi.fn()} workspaceId="other-ws" savedReplyMode="sales" />);
      await waitFor(() => expect(pagesApi.getAll).toHaveBeenCalled());
      expect(screen.queryByText(QUESTION)).not.toBeInTheDocument();
    });

    it('workspace scope: picking «Information source» updates the settings draft (saved via the settings path)', async () => {
      vi.mocked(pagesApi.getAll).mockResolvedValueOnce({ data: TWO_PAGES } as never);
      const setSettings = vi.fn();
      render(<ReplyStyleCard settings={makeSettings()} setSettings={setSettings} workspaceId="mode-ws" savedReplyMode="sales" />);
      await screen.findByText(QUESTION);

      fireEvent.click(screen.getByRole('radio', { name: /Information source/i }));
      expect(setSettings).toHaveBeenCalledWith(expect.objectContaining({ replyMode: 'info' }));
      // Never a direct PATCH from the workspace scope — the page-bottom save owns it.
      expect(pagesApi.updateReplyMode).not.toHaveBeenCalled();
    });

    it('shows the quiet-leads note exactly when the selection means info', async () => {
      vi.mocked(pagesApi.getAll).mockResolvedValueOnce({ data: TWO_PAGES } as never);
      const { rerender } = render(
        <ReplyStyleCard settings={makeSettings()} setSettings={vi.fn()} workspaceId="mode-ws" savedReplyMode="sales" />,
      );
      await screen.findByText(QUESTION);
      expect(screen.queryByText(/saved to Leads automatically without sending alerts/i)).not.toBeInTheDocument();

      rerender(
        <ReplyStyleCard key="info" settings={makeSettings({ replyMode: 'info' })} setSettings={vi.fn()} workspaceId="mode-ws" savedReplyMode="info" />,
      );
      expect(screen.getByText(/saved to Leads automatically without sending alerts/i)).toBeInTheDocument();
    });

    it('page scope: three options; picking one PATCHes immediately and pins the page', async () => {
      vi.mocked(pagesApi.getAll).mockResolvedValueOnce({ data: TWO_PAGES } as never);
      vi.mocked(pagesApi.updateReplyMode).mockResolvedValue({ data: { ...TWO_PAGES[0], replyMode: 'info' } } as never);
      render(<ReplyStyleCard settings={makeSettings()} setSettings={vi.fn()} workspaceId="mode-ws" savedReplyMode="sales" />);
      await screen.findByText(QUESTION);

      fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'p1' } });

      // Inherit option names the SAVED workspace default.
      const inherit = screen.getByRole('radio', { name: /Default \(Sales assistant\)/i });
      expect(inherit).toHaveAttribute('aria-checked', 'true');

      fireEvent.click(screen.getByRole('radio', { name: /Information source/i }));
      await waitFor(() => expect(pagesApi.updateReplyMode).toHaveBeenCalledWith('p1', 'info'));
      // The page's option list marks the pinned page in the switcher.
      expect(await screen.findByText(/Resort Page — Information source/i)).toBeInTheDocument();
    });

    it('page scope: CONFIRMS the save — an instant save with no button must not be silent', async () => {
      // There is no Save button in page scope (the PATCH fires on click), so
      // without a visible confirmation the click looks like nothing happened
      // and the merchant hunts for a Save button that does not exist
      // (owner report 2026-08-17).
      vi.mocked(pagesApi.getAll).mockResolvedValueOnce({ data: TWO_PAGES } as never);
      vi.mocked(pagesApi.updateReplyMode).mockResolvedValue({ data: { ...TWO_PAGES[0], replyMode: 'info' } } as never);
      render(<ReplyStyleCard settings={makeSettings()} setSettings={vi.fn()} workspaceId="mode-ws" savedReplyMode="sales" />);
      await screen.findByText(QUESTION);
      fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'p1' } });

      expect(screen.queryByText(/Saved for this page/i)).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('radio', { name: /Information source/i }));
      expect(await screen.findByText(/Saved for this page/i)).toBeInTheDocument();
    });

    it('page scope: rolls the pin back and shows an error when the PATCH fails', async () => {
      vi.mocked(pagesApi.getAll).mockResolvedValueOnce({ data: TWO_PAGES } as never);
      vi.mocked(pagesApi.updateReplyMode).mockRejectedValue({ response: { data: { code: 'REPLY_MODE_NOT_ENABLED' } } });
      render(<ReplyStyleCard settings={makeSettings()} setSettings={vi.fn()} workspaceId="mode-ws" savedReplyMode="sales" />);
      await screen.findByText(QUESTION);

      fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'p1' } });
      fireEvent.click(screen.getByRole('radio', { name: /Information source/i }));

      expect(await screen.findByRole('alert')).toHaveTextContent(/isn't enabled for your account/i);
      // Rolled back: inherit is selected again.
      expect(screen.getByRole('radio', { name: /Default \(Sales assistant\)/i })).toHaveAttribute('aria-checked', 'true');
    });

    it('keeps a DISCONNECTED page listed when its only override is a reply-mode pin', async () => {
      // The pin lives on the row, not the token: if a revoked token dropped the
      // page from the switcher, the merchant could neither see nor revert it,
      // and a reconnect would silently revive info mode on live traffic. Same
      // rule the persona filter already enforces (#797 review).
      vi.mocked(pagesApi.getAll).mockResolvedValueOnce({
        data: [
          TWO_PAGES[0],
          { id: 'p9', name: 'Revoked Page', isConnected: false, brandVoiceNotesMulti: null, replyMode: 'info' },
        ],
      } as never);
      render(<ReplyStyleCard settings={makeSettings()} setSettings={vi.fn()} workspaceId="mode-ws" savedReplyMode="sales" />);
      await screen.findByText(QUESTION);

      const options = Array.from(screen.getAllByRole('combobox')[0].querySelectorAll('option')).map((o) => o.textContent);
      expect(options.join('|')).toMatch(/Revoked Page/);
    });

    it('page scope: pins are disabled with a hint while the draft default is unsaved', async () => {
      vi.mocked(pagesApi.getAll).mockResolvedValueOnce({ data: TWO_PAGES } as never);
      // Draft says info, persisted default is still sales → block page pins.
      render(
        <ReplyStyleCard settings={makeSettings({ replyMode: 'info' })} setSettings={vi.fn()} workspaceId="mode-ws" savedReplyMode="sales" />,
      );
      await screen.findByText(QUESTION);
      fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'p1' } });

      expect(screen.getByText(/Save the default first/i)).toBeInTheDocument();
      const info = screen.getByRole('radio', { name: /Information source/i });
      expect(info).toBeDisabled();
      fireEvent.click(info);
      expect(pagesApi.updateReplyMode).not.toHaveBeenCalled();
    });
  });

  // ── Persona copy follows the assistant type (2026-08-17) ──────────────────
  // The placeholder used to instruct EVERY merchant to write «ask for the
  // customer's name and phone». In info mode the ai-worker's INFO-DESK block
  // explicitly overrides that instruction; in sales mode it changes nothing,
  // because asking is demonstrated by the static prefix, not by the persona.
  // So the card taught a behavioural line that was inert in one mode and
  // reversed in the other — and nothing on screen said so.
  describe('persona copy follows the reply mode', () => {
    const PAGES = [
      { id: 'p1', name: 'Resort Page', isConnected: true, brandVoiceNotesMulti: null, replyMode: null },
      { id: 'p2', name: 'Fashion Page', isConnected: true, brandVoiceNotesMulti: null, replyMode: null },
    ];
    const salesPlaceholder = enSettings.replyStyle.brandVoicePlaceholder;
    const infoPlaceholder = enSettings.replyStyle.brandVoicePlaceholderInfo;
    const infoNote = enSettings.replyStyle.infoModeNote;

    it('sales mode gets the sales placeholder and pays nothing for the info note', () => {
      render(<ReplyStyleCard settings={makeSettings({ replyMode: 'sales' })} setSettings={vi.fn()} workspaceId="mode-ws" />);

      expect(screen.getByPlaceholderText(salesPlaceholder)).toBeInTheDocument();
      // The extra line lands ONLY where an instruction would be reversed. A card
      // that grows on every merchant to warn the few is the wrong trade on a phone.
      expect(screen.queryByText(infoNote)).not.toBeInTheDocument();
    });

    it('info mode swaps the placeholder and states that a collect instruction will not run', () => {
      render(<ReplyStyleCard settings={makeSettings({ replyMode: 'info' })} setSettings={vi.fn()} workspaceId="mode-ws" />);

      expect(screen.getByPlaceholderText(infoPlaceholder)).toBeInTheDocument();
      expect(screen.getByText(infoNote)).toBeInTheDocument();
    });

    it('the copy follows the DRAFT, so guidance flips the moment the merchant picks a mode', () => {
      let current = makeSettings({ replyMode: 'sales' });
      const setSettings = vi.fn((next: SettingsState) => { current = next; });
      const { rerender } = render(
        <ReplyStyleCard settings={current} setSettings={setSettings} workspaceId="mode-ws" />,
      );

      fireEvent.click(screen.getByRole('radio', { name: /Information source/i }));
      rerender(<ReplyStyleCard settings={current} setSettings={setSettings} workspaceId="mode-ws" />);

      // Waiting for the save would leave the merchant writing against the old
      // guidance for the whole edit.
      expect(screen.getByPlaceholderText(infoPlaceholder)).toBeInTheDocument();
    });

    it('outside the pilot the copy stays sales even when settings.replyMode reads info', () => {
      // No mode control is rendered there, so info copy would describe a choice
      // the merchant cannot see, make, or undo.
      render(<ReplyStyleCard settings={makeSettings({ replyMode: 'info' })} setSettings={vi.fn()} workspaceId="other-ws" />);

      expect(screen.getByPlaceholderText(salesPlaceholder)).toBeInTheDocument();
      expect(screen.queryByText(infoNote)).not.toBeInTheDocument();
    });

    it('a page pinned to info gets the info copy though the workspace default is sales', async () => {
      vi.mocked(pagesApi.getAll).mockResolvedValueOnce({
        data: [{ ...PAGES[0], replyMode: 'info' }, PAGES[1]],
      } as never);
      render(
        <ReplyStyleCard
          settings={makeSettings({ replyMode: 'sales' })}
          setSettings={vi.fn()}
          savedReplyMode="sales"
          workspaceId="mode-ws"
        />,
      );
      await screen.findByText(/Editing persona for/i);

      fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'p1' } });

      // A page scope must describe what THAT page runs, not the workspace default.
      expect(screen.getByPlaceholderText(infoPlaceholder)).toBeInTheDocument();
      expect(screen.getByText(infoNote)).toBeInTheDocument();
    });
  });

  // ── Tone control (2026-08-17) ─────────────────────────────────────────────
  describe('tone control', () => {
    const PAGES = [
      { id: 'p1', name: 'Resort Page', isConnected: true, brandVoiceNotesMulti: null, replyMode: null },
      { id: 'p2', name: 'Fashion Page', isConnected: true, brandVoiceNotesMulti: null, replyMode: null },
    ];

    it('every tone option clears the 44px touch floor the rest of the card uses', () => {
      render(<ReplyStyleCard settings={makeSettings()} setSettings={vi.fn()} />);
      const tones = screen.getAllByRole('radio');
      expect(tones).toHaveLength(3);

      // jsdom has no layout, so the floor is pinned on the class that sets it.
      // The reply-mode options above already use min-h-[44px]; the tone strip was
      // 'px-2.5 py-1 text-xs' (~24px) — the only control on the card below the floor.
      tones.forEach((tone) => expect(tone.className).toContain('min-h-[44px]'));
    });

    it('describes the SELECTED tone, and the line follows the selection', () => {
      const { rerender } = render(
        <ReplyStyleCard settings={makeSettings({ replyStyle: 'casual' })} setSettings={vi.fn()} />,
      );
      expect(screen.getByText(enSettings.replyStyle.casualDesc)).toBeInTheDocument();
      expect(screen.queryByText(enSettings.replyStyle.professionalDesc)).not.toBeInTheDocument();

      rerender(<ReplyStyleCard settings={makeSettings({ replyStyle: 'professional' })} setSettings={vi.fn()} />);
      expect(screen.getByText(enSettings.replyStyle.professionalDesc)).toBeInTheDocument();
    });

    it('says the tone is workspace-wide ONLY inside a page scope, where that is invisible', async () => {
      vi.mocked(pagesApi.getAll).mockResolvedValueOnce({ data: PAGES } as never);
      render(<ReplyStyleCard settings={makeSettings()} setSettings={vi.fn()} />);
      await screen.findByText(/Editing persona for/i);

      // In «All pages» the scope already says it — a second line would repeat it.
      expect(screen.queryByText(enSettings.replyStyle.tonePageNote)).not.toBeInTheDocument();

      fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'p1' } });
      expect(screen.getByText(enSettings.replyStyle.tonePageNote)).toBeInTheDocument();
    });
  });

  // ── Test button vs unsaved work (2026-08-17) ──────────────────────────────
  // `hasChanges` covers only the WORKSPACE draft. A page persona lives in local
  // `pageDraft`, so a page-scope edit left Test ENABLED and the reply came from
  // the SAVED persona while the new text sat on screen — a plausible answer from
  // the wrong input, which reads as "my words had no effect".
  describe('test button vs unsaved work', () => {
    const PAGES = [
      { id: 'p1', name: 'Resort Page', isConnected: true, brandVoiceNotesMulti: null, replyMode: null },
      { id: 'p2', name: 'Fashion Page', isConnected: true, brandVoiceNotesMulti: null, replyMode: null },
    ];
    const testBtn = () => screen.getByRole('button', { name: new RegExp(enSettings.replyStyle.openTestModal, 'i') });

    it('an unsaved PAGE persona edit blocks the test, with the save-first reason', async () => {
      vi.mocked(pagesApi.getAll).mockResolvedValueOnce({ data: PAGES } as never);
      const settings = makeSettings({ brandVoiceNotesMulti: { en: 'Saved workspace persona', sourceLang: 'en' } });
      render(
        <ReplyStyleCard
          settings={settings}
          setSettings={vi.fn()}
          hasChanges={false}
          savedBrandVoiceNotesMulti={settings.brandVoiceNotesMulti}
        />,
      );
      await screen.findByText(/Editing persona for/i);
      fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'p1' } });

      expect(testBtn()).toBeEnabled();

      fireEvent.change(screen.getByRole('textbox', { name: pageEditorName('Resort Page') }), {
        target: { value: 'A brand new page persona the merchant has not saved' },
      });

      expect(testBtn()).toBeDisabled();
      expect(testBtn()).toHaveAttribute('title', enSettings.replyStyle.testSaveFirst);
    });

    it('an untouched page scope still allows the test', async () => {
      vi.mocked(pagesApi.getAll).mockResolvedValueOnce({ data: PAGES } as never);
      const settings = makeSettings({ brandVoiceNotesMulti: { en: 'Saved workspace persona', sourceLang: 'en' } });
      render(
        <ReplyStyleCard
          settings={settings}
          setSettings={vi.fn()}
          hasChanges={false}
          savedBrandVoiceNotesMulti={settings.brandVoiceNotesMulti}
        />,
      );
      await screen.findByText(/Editing persona for/i);
      fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'p1' } });

      // Merely LOOKING at a page must not block testing it.
      expect(testBtn()).toBeEnabled();
    });

    it('a saved workspace persona does NOT block the test outside a page scope', () => {
      // The trap in the fix: outside a page scope the seeding effect returns
      // early, so `pageDraft` is '' while `pageEffectiveText` is the workspace
      // persona — an ungated `pageDraftChanged` reads true and would disable the
      // button for EVERY merchant who has ever written a persona.
      const settings = makeSettings({ brandVoiceNotesMulti: { en: 'Saved workspace persona', sourceLang: 'en' } });
      render(
        <ReplyStyleCard
          settings={settings}
          setSettings={vi.fn()}
          hasChanges={false}
          savedBrandVoiceNotesMulti={settings.brandVoiceNotesMulti}
        />,
      );

      expect(testBtn()).toBeEnabled();
    });
  });
});
