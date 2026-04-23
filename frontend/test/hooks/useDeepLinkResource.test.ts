import { renderHook, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// ── Router mock ───────────────────────────────────────────────────────────────

let mockIsReady = true;
let mockQuery: Record<string, string | string[] | undefined> = {};
const mockReplace = vi.fn().mockResolvedValue(true);

vi.mock('next/router', () => ({
  useRouter: () => ({
    isReady: mockIsReady,
    query: mockQuery,
    pathname: '/messages',
    replace: mockReplace,
  }),
}));

Object.defineProperty(window, 'location', {
  value: { search: '' },
  writable: true,
});

// ── Toast mock ────────────────────────────────────────────────────────────────

const mockToastInfo = vi.fn();
const mockToastError = vi.fn();

vi.mock('sonner', () => ({
  toast: {
    info: (...args: unknown[]) => mockToastInfo(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

// ── next-intl mock ────────────────────────────────────────────────────────────

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

// ── Sentry mock ───────────────────────────────────────────────────────────────

const mockCaptureError = vi.fn();
vi.mock('@/lib/sentryHelpers', () => ({
  captureError: (...args: unknown[]) => mockCaptureError(...args),
}));

// ── Test harness ──────────────────────────────────────────────────────────────

interface TestResource { id: string; label: string }

const errorTag = { page: 'test', action: 'deep-link' } as const;
const notFoundMessage = 'not found';

async function mount(fetchImpl: (id: string) => Promise<TestResource | null>, onOpen: (r: TestResource) => void) {
  const { useDeepLinkResource } = await import('@/hooks/useDeepLinkResource');
  return renderHook(() =>
    useDeepLinkResource<TestResource>('messageId', {
      fetch: fetchImpl,
      onOpen,
      notFoundMessage,
      errorTag,
    }),
  );
}

describe('useDeepLinkResource', () => {
  beforeEach(() => {
    mockIsReady = true;
    mockQuery = {};
    mockReplace.mockClear();
    mockToastInfo.mockClear();
    mockToastError.mockClear();
    mockCaptureError.mockClear();
    (window.location as { search: string }).search = '';
  });

  it('is a no-op when the deep-link param is absent', async () => {
    const fetchFn = vi.fn();
    const onOpen = vi.fn();
    await mount(fetchFn, onOpen);

    expect(fetchFn).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('fetches and opens the resource when the param is present', async () => {
    mockQuery = { messageId: 'msg-42' };
    (window.location as { search: string }).search = '?messageId=msg-42';

    const resource: TestResource = { id: 'msg-42', label: 'hello' };
    const fetchFn = vi.fn().mockResolvedValue(resource);
    const onOpen = vi.fn();
    await mount(fetchFn, onOpen);

    await waitFor(() => expect(onOpen).toHaveBeenCalledWith(resource));
    expect(fetchFn).toHaveBeenCalledWith('msg-42');
    expect(mockToastInfo).not.toHaveBeenCalled();
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it('shows the not-found toast when fetch returns null', async () => {
    mockQuery = { messageId: 'msg-gone' };
    (window.location as { search: string }).search = '?messageId=msg-gone';

    const fetchFn = vi.fn().mockResolvedValue(null);
    const onOpen = vi.fn();
    await mount(fetchFn, onOpen);

    await waitFor(() => expect(mockToastInfo).toHaveBeenCalledWith(notFoundMessage));
    expect(onOpen).not.toHaveBeenCalled();
    expect(mockCaptureError).not.toHaveBeenCalled();
  });

  it('shows the not-found toast on a 404 error', async () => {
    mockQuery = { messageId: 'msg-404' };
    (window.location as { search: string }).search = '?messageId=msg-404';

    const fetchFn = vi.fn().mockRejectedValue({ response: { status: 404 } });
    const onOpen = vi.fn();
    await mount(fetchFn, onOpen);

    await waitFor(() => expect(mockToastInfo).toHaveBeenCalledWith(notFoundMessage));
    expect(onOpen).not.toHaveBeenCalled();
    expect(mockCaptureError).not.toHaveBeenCalled();
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it('reports unexpected errors to Sentry and shows a generic error toast', async () => {
    mockQuery = { messageId: 'msg-boom' };
    (window.location as { search: string }).search = '?messageId=msg-boom';

    const err = new Error('network down');
    const fetchFn = vi.fn().mockRejectedValue(err);
    const onOpen = vi.fn();
    await mount(fetchFn, onOpen);

    await waitFor(() => expect(mockCaptureError).toHaveBeenCalledTimes(1));
    expect(mockCaptureError).toHaveBeenCalledWith(
      err,
      expect.stringContaining('test'),
      expect.objectContaining({ tags: errorTag }),
    );
    expect(mockToastError).toHaveBeenCalledWith('error');
    expect(mockToastInfo).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
  });
});
