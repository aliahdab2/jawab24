import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import enComments from '@/i18n/en/comments.json';
import arComments from '@/i18n/ar/comments.json';
import { useDeepLinkResource } from '../useDeepLinkResource';

/**
 * The notification deep-link handoff. Previously untested end to end: the
 * not-found copy shown here is what a merchant sees when a notification tap
 * fails, and no suite asserted it in either locale.
 *
 * These tests also pin WHY the toast fires. The copy must not claim a cause —
 * `fetch` is by-id (`GET /comments/:id`, `GET /leads/:id`, `locateMessage`) and
 * this hook deliberately bypasses list filters, so the only two paths to the
 * toast are "server says absent" (null) and 404. A page filter cannot reach it.
 */

const mockToastInfo = vi.fn();
const mockToastError = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    info: (...args: unknown[]) => mockToastInfo(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

const mockCaptureError = vi.fn();
vi.mock('@/lib/sentryHelpers', () => ({
  captureError: (...args: unknown[]) => mockCaptureError(...args),
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => `common.${key}`,
}));

let mockDeepLinkId: string | undefined;
vi.mock('../useDeepLinkParam', () => ({
  useDeepLinkParam: () => mockDeepLinkId,
}));

function Probe({
  fetch,
  onOpen,
  notFoundMessage,
}: {
  fetch: (id: string) => Promise<unknown>;
  onOpen: (item: unknown) => void;
  notFoundMessage: string;
}) {
  useDeepLinkResource<unknown>('commentId', {
    fetch,
    onOpen,
    notFoundMessage,
    errorTag: { page: 'comments', action: 'open-deep-link' },
  });
  return null;
}

describe('useDeepLinkResource', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDeepLinkId = 'c1';
  });

  it('opens the resource when the fetch resolves, with no toast', async () => {
    const item = { id: 'c1' };
    const onOpen = vi.fn();
    render(<Probe fetch={vi.fn().mockResolvedValue(item)} onOpen={onOpen} notFoundMessage="nf" />);

    await waitFor(() => expect(onOpen).toHaveBeenCalledWith(item));
    expect(mockToastInfo).not.toHaveBeenCalled();
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it('shows the not-found copy when the server reports the resource absent', async () => {
    const onOpen = vi.fn();
    render(
      <Probe
        fetch={vi.fn().mockResolvedValue(null)}
        onOpen={onOpen}
        notFoundMessage={enComments.deepLinkNotFound}
      />,
    );

    await waitFor(() => expect(mockToastInfo).toHaveBeenCalledWith(enComments.deepLinkNotFound));
    expect(onOpen).not.toHaveBeenCalled();
    expect(mockCaptureError).not.toHaveBeenCalled();
  });

  it('shows the same copy on a 404, and does NOT report it to Sentry', async () => {
    render(
      <Probe
        fetch={vi.fn().mockRejectedValue({ response: { status: 404 } })}
        onOpen={vi.fn()}
        notFoundMessage={enComments.deepLinkNotFound}
      />,
    );

    await waitFor(() => expect(mockToastInfo).toHaveBeenCalledWith(enComments.deepLinkNotFound));
    // A missing row is expected, not an incident — reporting it would bury real ones.
    expect(mockCaptureError).not.toHaveBeenCalled();
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it('reports an unexpected failure to Sentry and shows the generic error instead', async () => {
    render(
      <Probe
        fetch={vi.fn().mockRejectedValue({ response: { status: 500 } })}
        onOpen={vi.fn()}
        notFoundMessage={enComments.deepLinkNotFound}
      />,
    );

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('common.error'));
    expect(mockCaptureError).toHaveBeenCalledTimes(1);
    // The not-found copy must NOT be used for a server fault — it would tell the
    // merchant the row is gone when the row is fine.
    expect(mockToastInfo).not.toHaveBeenCalled();
  });

  it('does nothing without a deep-link param', async () => {
    mockDeepLinkId = undefined;
    const fetch = vi.fn();
    render(<Probe fetch={fetch} onOpen={vi.fn()} notFoundMessage="nf" />);

    await waitFor(() => expect(fetch).not.toHaveBeenCalled());
    expect(mockToastInfo).not.toHaveBeenCalled();
  });
});

describe('deep-link not-found copy', () => {
  // The old copy asserted deletion ("may have already been handled or removed")
  // for a row that exists; its replacement asserted a page filter that cannot
  // produce this toast. Both named a cause we had not established. The copy now
  // states the failure and offers a recovery, and these assertions keep it that
  // way in both locales.
  const surfaces = [
    ['en', enComments.deepLinkNotFound],
    ['ar', arComments.deepLinkNotFound],
  ] as const;

  it.each(surfaces)('[%s] is present and non-empty', (_locale, copy) => {
    expect(copy.trim().length).toBeGreaterThan(0);
  });

  it.each(surfaces)('[%s] claims no cause we have not established', (_locale, copy) => {
    // "removed"/"deleted" and "filter" are the two unproven explanations that
    // shipped. Until a root cause is measured, neither belongs in this string.
    const unproven = ['removed', 'deleted', 'filter', 'حُذف', 'حذف', 'الفلتر'];
    const found = unproven.filter(word => copy.includes(word));
    expect(found, `copy asserts an unestablished cause: ${found.join(', ')}`).toEqual([]);
  });

  it.each(surfaces)('[%s] tells the merchant what to do next', (_locale, copy) => {
    const recovery = ['list', 'refresh', 'القائمة', 'تحميل'];
    expect(recovery.some(word => copy.includes(word)), `no recovery action in: ${copy}`).toBe(true);
  });
});
