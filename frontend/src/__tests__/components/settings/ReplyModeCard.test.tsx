import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ReplyModeCard } from '@/components/settings/ReplyModeCard';
import type { SettingsState } from '@/components/settings/types';

vi.mock('@/lib/api', () => ({
  pagesApi: {
    getAll: vi.fn(),
    updateReplyMode: vi.fn(),
  },
}));

vi.mock('@/components/ui', () => import('../../testUtils/uiMocks'));

vi.mock('@/lib/sentryHelpers', () => ({ captureError: vi.fn() }));

// next-intl mock from setup.ts handles `useTranslations` automatically with real EN strings.

import { pagesApi } from '@/lib/api';
import { makeSettings } from '../../testUtils/settingsFactory';

const PAGES = [
  { id: 'p-1', name: 'Shahin Resort', isConnected: true, replyMode: null },
  { id: 'p-2', name: 'Shahin World', isConnected: true, replyMode: null },
];

describe('ReplyModeCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(pagesApi.getAll).mockResolvedValue({ data: PAGES } as never);
    vi.mocked(pagesApi.updateReplyMode).mockResolvedValue({ data: {} } as never);
  });

  it('selecting Information desk updates settings.replyMode (saved via the normal settings PUT)', () => {
    let current = makeSettings(); // replyMode: 'sales'
    const setSettings = vi.fn((s: SettingsState) => { current = s; });

    render(<ReplyModeCard settings={current} setSettings={setSettings} />);

    fireEvent.click(screen.getByRole('radio', { name: /Information desk/i }));
    expect(setSettings).toHaveBeenCalledWith(expect.objectContaining({ replyMode: 'info' }));
  });

  it('renders the per-page override rows for multi-page workspaces', async () => {
    render(<ReplyModeCard settings={makeSettings()} setSettings={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Shahin Resort')).toBeInTheDocument();
      expect(screen.getByText('Shahin World')).toBeInTheDocument();
    });
  });

  it('pinning a page to info PATCHes that page only (null-inherit semantics untouched elsewhere)', async () => {
    render(<ReplyModeCard settings={makeSettings()} setSettings={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Shahin Resort')).toBeInTheDocument());

    const resortGroup = screen.getByRole('radiogroup', { name: /Shahin Resort/i });
    const infoRadio = Array.from(resortGroup.querySelectorAll('input[type="radio"]')).find(
      (r) => (r as HTMLInputElement).value === 'info',
    ) as HTMLInputElement;
    fireEvent.click(infoRadio);

    await waitFor(() => {
      expect(pagesApi.updateReplyMode).toHaveBeenCalledTimes(1);
      expect(pagesApi.updateReplyMode).toHaveBeenCalledWith('p-1', 'info');
    });
  });

  it('reverting a pinned page to inherit sends null', async () => {
    vi.mocked(pagesApi.getAll).mockResolvedValue({
      data: [{ ...PAGES[0], replyMode: 'info' }, PAGES[1]],
    } as never);
    render(<ReplyModeCard settings={makeSettings()} setSettings={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Shahin Resort')).toBeInTheDocument());

    const resortGroup = screen.getByRole('radiogroup', { name: /Shahin Resort/i });
    const inheritRadio = Array.from(resortGroup.querySelectorAll('input[type="radio"]')).find(
      (r) => (r as HTMLInputElement).value === 'inherit',
    ) as HTMLInputElement;
    fireEvent.click(inheritRadio);

    await waitFor(() => {
      expect(pagesApi.updateReplyMode).toHaveBeenCalledWith('p-1', null);
    });
  });

  it('a failed page PATCH rolls the row back and shows the error', async () => {
    vi.mocked(pagesApi.updateReplyMode).mockRejectedValue(new Error('403'));
    render(<ReplyModeCard settings={makeSettings()} setSettings={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Shahin Resort')).toBeInTheDocument());

    const resortGroup = screen.getByRole('radiogroup', { name: /Shahin Resort/i });
    const infoRadio = Array.from(resortGroup.querySelectorAll('input[type="radio"]')).find(
      (r) => (r as HTMLInputElement).value === 'info',
    ) as HTMLInputElement;
    fireEvent.click(infoRadio);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    // Rolled back: the inherit radio is checked again for that row.
    const inheritRadio = Array.from(resortGroup.querySelectorAll('input[type="radio"]')).find(
      (r) => (r as HTMLInputElement).value === 'inherit',
    ) as HTMLInputElement;
    expect(inheritRadio.checked).toBe(true);
  });

  it('hides the per-page list for single-page workspaces (workspace default is enough)', async () => {
    vi.mocked(pagesApi.getAll).mockResolvedValue({ data: [PAGES[0]] } as never);
    render(<ReplyModeCard settings={makeSettings()} setSettings={vi.fn()} />);

    await waitFor(() => expect(pagesApi.getAll).toHaveBeenCalled());
    expect(screen.queryByText('Shahin Resort')).not.toBeInTheDocument();
  });
});
