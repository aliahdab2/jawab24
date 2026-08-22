import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { StoreAutoReplyRow } from '@/components/onboarding/StoreAutoReplyRow';
import { SETTINGS_QUERY_KEY } from '@/hooks/useSettingsQuery';
import enOnboarding from '@/i18n/en/onboarding.json';
import type { Page } from '@jawab24/shared';

vi.mock('@/lib/api', () => ({
  settingsApi: {
    get: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// The row reads through useSettingsQuery, which is gated on authentication —
// an unauthenticated mount would never fetch and every test would hang on the
// loading placeholder.
vi.mock('@/lib/store', () => ({
  useAuthStore: (selector: (s: { isAuthenticated: boolean }) => unknown) =>
    selector({ isAuthenticated: true }),
}));

import { settingsApi } from '@/lib/api';
import { toast } from 'sonner';

// Selectors read the SHIPPED strings, never copies of them (Rule 10.6).
const ACTIVE = enOnboarding.storeAutoReplyActive;
const ACTIVE_HOURS = enOnboarding.storeAutoReplyActiveHours;
const OFF = enOnboarding.storeAutoReplyOff;
const ENABLE = enOnboarding.storeAutoReplyEnable;

const pageFixture = (autoReplyEnabled: boolean | null): Page =>
  ({ id: 'page-1', name: 'Damascus Team', facebookPageId: 'fb-1', autoReplyEnabled } as Page);

let queryClient: QueryClient;

function renderRow(props: { page?: Page | null } = {}) {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider locale="en" messages={{ onboarding: enOnboarding }}>
        <StoreAutoReplyRow {...props} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

/**
 * The marketplace onboarding "done" step used to print «الردود التلقائية
 * مفعّلة» unconditionally — it read nothing and enabled nothing, while every
 * new workspace is seeded with auto-reply OFF (D-025). Live-reproduced on the
 * Zid dev store 2026-08-22: the screen said "active", the workspace said
 * false/false, and the first customer DM was skipped with "Messages auto-reply
 * disabled". These tests pin the honest replacement.
 */
describe('StoreAutoReplyRow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows ACTIVE only when the settings read says both surfaces are on', async () => {
    vi.mocked(settingsApi.get).mockResolvedValue({
      data: { messagesAutoReply: true, commentsAutoReply: true },
    } as never);

    renderRow();

    expect(await screen.findByText(ACTIVE)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: ENABLE })).not.toBeInTheDocument();
  });

  it('shows OFF + an enable button when the workspace seed left auto-reply off', async () => {
    // The D-025 seed: a brand-new marketplace workspace.
    vi.mocked(settingsApi.get).mockResolvedValue({
      data: { messagesAutoReply: false, commentsAutoReply: false },
    } as never);

    renderRow();

    expect(await screen.findByText(OFF)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: ENABLE })).toBeInTheDocument();
    // The old unconditional claim must be gone.
    expect(screen.queryByText(ACTIVE)).not.toBeInTheDocument();
  });

  it('treats one surface off as OFF — "active" means both, not either', async () => {
    vi.mocked(settingsApi.get).mockResolvedValue({
      data: { messagesAutoReply: true, commentsAutoReply: false },
    } as never);

    renderRow();

    expect(await screen.findByText(OFF)).toBeInTheDocument();
  });

  it('never claims ACTIVE when the settings read fails — offers enable instead', async () => {
    vi.mocked(settingsApi.get).mockRejectedValue(new Error('network'));

    renderRow();

    expect(await screen.findByRole('button', { name: ENABLE })).toBeInTheDocument();
    expect(screen.queryByText(ACTIVE)).not.toBeInTheDocument();
  });

  it('claims nothing at all while the read is still in flight', async () => {
    // Colour is read before text: success chrome here would be the same lie one
    // beat earlier. The placeholder must assert neither state.
    vi.mocked(settingsApi.get).mockReturnValue(new Promise(() => { }) as never);

    const { container } = renderRow();

    expect(screen.queryByText(ACTIVE)).not.toBeInTheDocument();
    expect(screen.queryByText(OFF)).not.toBeInTheDocument();
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    expect(container.querySelector('.alert-success')).toBeNull();
  });

  // --- Gate 1: the page master switch outranks the workspace switches --------

  it('does not claim ACTIVE when the linked PAGE has auto-reply off', async () => {
    // "Page OFF = Jawab24 invisible: no reply, no flag, no notification"
    // (SETTINGS.md, gate 1). Reachable from this very flow: a channel that
    // already used its free trial is connected with the master off.
    vi.mocked(settingsApi.get).mockResolvedValue({
      data: { messagesAutoReply: true, commentsAutoReply: true },
    } as never);

    renderRow({ page: pageFixture(false) });

    expect(await screen.findByText(/Damascus Team/)).toBeInTheDocument();
    expect(screen.queryByText(ACTIVE)).not.toBeInTheDocument();
  });

  it('does not offer the settings write when the PAGE is the thing that is off', async () => {
    // Flipping the workspace masters would change nothing, and the page master
    // is an abuse guard — not a preference this screen may override.
    vi.mocked(settingsApi.get).mockResolvedValue({
      data: { messagesAutoReply: false, commentsAutoReply: false },
    } as never);

    renderRow({ page: pageFixture(false) });

    await screen.findByText(/Damascus Team/);
    expect(screen.queryByRole('button', { name: ENABLE })).not.toBeInTheDocument();
  });

  it('reads ACTIVE normally when the linked page master is on', async () => {
    vi.mocked(settingsApi.get).mockResolvedValue({
      data: { messagesAutoReply: true, commentsAutoReply: true },
    } as never);

    renderRow({ page: pageFixture(true) });

    expect(await screen.findByText(ACTIVE)).toBeInTheDocument();
  });

  // --- Gate 5 is the masters FOLDED with the schedule -----------------------

  it('qualifies the claim when replies only run during business hours', async () => {
    vi.mocked(settingsApi.get).mockResolvedValue({
      data: { messagesAutoReply: true, commentsAutoReply: true, businessHoursOnly: true },
    } as never);

    renderRow();

    expect(await screen.findByText(ACTIVE_HOURS)).toBeInTheDocument();
    expect(screen.queryByText(ACTIVE)).not.toBeInTheDocument();
  });

  // --- The write ------------------------------------------------------------

  it('enables BOTH surfaces through the sanctioned settings write, then reads ACTIVE', async () => {
    vi.mocked(settingsApi.get)
      .mockResolvedValueOnce({ data: { messagesAutoReply: false, commentsAutoReply: false } } as never)
      .mockResolvedValue({ data: { messagesAutoReply: true, commentsAutoReply: true } } as never);
    vi.mocked(settingsApi.update).mockResolvedValue({ data: {} } as never);

    renderRow();
    fireEvent.click(await screen.findByRole('button', { name: ENABLE }));

    await waitFor(() => expect(screen.getByText(ACTIVE)).toBeInTheDocument());
    // The exact payload matters: enabling only messages would leave comments
    // silently off, which is the same "told it's on, it isn't" defect in a
    // smaller coat.
    expect(settingsApi.update).toHaveBeenCalledWith({
      messagesAutoReply: true,
      commentsAutoReply: true,
    });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('invalidates the shared settings key so the dashboard cannot keep showing OFF', async () => {
    // SETTINGS_QUERY_KEY has staleTime 5m and the dashboard's auto-reply masters
    // read through it. Without this the merchant taps enable, walks to the
    // dashboard, and is told replies are off for another five minutes.
    vi.mocked(settingsApi.get).mockResolvedValue({
      data: { messagesAutoReply: false, commentsAutoReply: false },
    } as never);
    vi.mocked(settingsApi.update).mockResolvedValue({ data: {} } as never);

    renderRow();
    await screen.findByRole('button', { name: ENABLE });
    // One read so far. Invalidating the shared key must force a SECOND — that
    // refetch is the observable proof the cache was busted, and it is what the
    // dashboard's own observer will do when it mounts.
    expect(settingsApi.get).toHaveBeenCalledTimes(1);
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    fireEvent.click(screen.getByRole('button', { name: ENABLE }));

    await waitFor(() => expect(settingsApi.get).toHaveBeenCalledTimes(2));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: SETTINGS_QUERY_KEY });
  });

  it('keeps its accessible name while the write is in flight', async () => {
    // A spinner-only button is an unnamed control (WCAG 4.1.2). The shared
    // Button keeps the label mounted at opacity-0 rather than replacing it.
    vi.mocked(settingsApi.get).mockResolvedValue({
      data: { messagesAutoReply: false, commentsAutoReply: false },
    } as never);
    let resolveWrite: () => void = () => { };
    vi.mocked(settingsApi.update).mockReturnValue(
      new Promise<never>((res) => { resolveWrite = res as unknown as () => void; }) as never,
    );

    renderRow();
    fireEvent.click(await screen.findByRole('button', { name: ENABLE }));

    // Mid-write: still findable BY NAME, and marked busy.
    const button = await screen.findByRole('button', { name: ENABLE });
    expect(button).toBeDisabled();
    resolveWrite();
  });

  it('stays OFF and reports the failure when the write is rejected', async () => {
    vi.mocked(settingsApi.get).mockResolvedValue({
      data: { messagesAutoReply: false, commentsAutoReply: false },
    } as never);
    vi.mocked(settingsApi.update).mockRejectedValue(new Error('500'));

    renderRow();
    fireEvent.click(await screen.findByRole('button', { name: ENABLE }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(enOnboarding.storeAutoReplyEnableFailed));
    expect(screen.getByText(OFF)).toBeInTheDocument();
    expect(screen.queryByText(ACTIVE)).not.toBeInTheDocument();
  });
});
