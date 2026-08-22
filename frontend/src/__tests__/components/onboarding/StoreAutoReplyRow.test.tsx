import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { StoreAutoReplyRow } from '@/components/onboarding/StoreAutoReplyRow';
import enOnboarding from '@/i18n/en/onboarding.json';

vi.mock('@/lib/api', () => ({
  settingsApi: {
    get: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { settingsApi } from '@/lib/api';
import { toast } from 'sonner';

// Selectors read the SHIPPED strings, never copies of them (Rule 10.6).
const ACTIVE = enOnboarding.storeAutoReplyActive;
const OFF = enOnboarding.storeAutoReplyOff;
const ENABLE = enOnboarding.storeAutoReplyEnable;

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

    render(<StoreAutoReplyRow />);

    expect(await screen.findByText(ACTIVE)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: ENABLE })).not.toBeInTheDocument();
  });

  it('shows OFF + an enable button when the workspace seed left auto-reply off', async () => {
    // The D-025 seed: a brand-new marketplace workspace.
    vi.mocked(settingsApi.get).mockResolvedValue({
      data: { messagesAutoReply: false, commentsAutoReply: false },
    } as never);

    render(<StoreAutoReplyRow />);

    expect(await screen.findByText(OFF)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: ENABLE })).toBeInTheDocument();
    // The old unconditional claim must be gone.
    expect(screen.queryByText(ACTIVE)).not.toBeInTheDocument();
  });

  it('treats one surface off as OFF — "active" means both, not either', async () => {
    vi.mocked(settingsApi.get).mockResolvedValue({
      data: { messagesAutoReply: true, commentsAutoReply: false },
    } as never);

    render(<StoreAutoReplyRow />);

    expect(await screen.findByText(OFF)).toBeInTheDocument();
  });

  it('never claims ACTIVE when the settings read fails — offers enable instead', async () => {
    vi.mocked(settingsApi.get).mockRejectedValue(new Error('network'));

    render(<StoreAutoReplyRow />);

    expect(await screen.findByRole('button', { name: ENABLE })).toBeInTheDocument();
    expect(screen.queryByText(ACTIVE)).not.toBeInTheDocument();
  });

  it('enables BOTH surfaces through the sanctioned settings write, then reads ACTIVE', async () => {
    vi.mocked(settingsApi.get).mockResolvedValue({
      data: { messagesAutoReply: false, commentsAutoReply: false },
    } as never);
    vi.mocked(settingsApi.update).mockResolvedValue({ data: {} } as never);

    render(<StoreAutoReplyRow />);
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

  it('stays OFF and reports the failure when the write is rejected', async () => {
    vi.mocked(settingsApi.get).mockResolvedValue({
      data: { messagesAutoReply: false, commentsAutoReply: false },
    } as never);
    vi.mocked(settingsApi.update).mockRejectedValue(new Error('500'));

    render(<StoreAutoReplyRow />);
    fireEvent.click(await screen.findByRole('button', { name: ENABLE }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(enOnboarding.storeAutoReplyEnableFailed));
    expect(screen.getByText(OFF)).toBeInTheDocument();
    expect(screen.queryByText(ACTIVE)).not.toBeInTheDocument();
  });
});
