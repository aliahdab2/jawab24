import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const mockPut = vi.fn();
vi.mock('@/lib/api', () => ({
  api: { put: (...args: unknown[]) => mockPut(...args) },
}));

const mockToastError = vi.fn();
vi.mock('sonner', () => ({
  toast: { error: (...a: unknown[]) => mockToastError(...a), success: vi.fn() },
}));

const mockCaptureError = vi.fn();
vi.mock('@/lib/sentryHelpers', () => ({
  captureError: (...a: unknown[]) => mockCaptureError(...a),
}));

// Import after mocks
import { useSaveKnowledgeBase } from '@/hooks/useSaveKnowledgeBase';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useSaveKnowledgeBase', () => {
  it('PUTs the KB text, returns { ok: true, kbWarnings }, and notifies onSuccess on success', async () => {
    const warnings = { hasCatalog: true, reasons: ['price_list'], priceCount: 12, courseKeywordCount: 0 };
    mockPut.mockResolvedValue({ data: { kbWarnings: warnings } });
    const onSuccess = vi.fn();

    const { result } = renderHook(() => useSaveKnowledgeBase(onSuccess));

    let returned: unknown;
    await act(async () => {
      returned = await result.current.saveKnowledgeBase('page-1', 'new kb text');
    });

    expect(mockPut).toHaveBeenCalledWith('/pages/page-1', { knowledgeBase: 'new kb text' });
    expect(returned).toEqual({ ok: true, kbWarnings: warnings });
    expect(onSuccess).toHaveBeenCalledWith('page-1', 'new kb text');
    expect(result.current.saved).toBe(true);
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it('toasts access-revoked and does NOT call onSuccess on 403 WORKSPACE_ACCESS_DENIED', async () => {
    mockPut.mockRejectedValue({ response: { status: 403, data: { code: 'WORKSPACE_ACCESS_DENIED' } } });
    const onSuccess = vi.fn();

    const { result } = renderHook(() => useSaveKnowledgeBase(onSuccess));

    let returned: unknown = 'sentinel';
    await act(async () => {
      returned = await result.current.saveKnowledgeBase('page-1', 'text');
    });

    // Failure is distinguishable from success-without-warnings (both used to
    // be `undefined`) — the catalog CTA gates its handoff on this.
    expect(returned).toEqual({ ok: false });
    expect(onSuccess).not.toHaveBeenCalled();
    expect(mockToastError).toHaveBeenCalledTimes(1);
    // Access-revoked is an expected authorization outcome, not an error to report to Sentry.
    expect(mockCaptureError).not.toHaveBeenCalled();
    expect(result.current.saved).toBe(false);
  });

  it('reports to Sentry and toasts a generic error on other failures', async () => {
    mockPut.mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => useSaveKnowledgeBase());

    let returned: unknown = 'sentinel';
    await act(async () => {
      returned = await result.current.saveKnowledgeBase('page-1', 'text');
    });

    expect(returned).toEqual({ ok: false });
    expect(mockCaptureError).toHaveBeenCalledTimes(1);
    expect(mockToastError).toHaveBeenCalledTimes(1);
  });

  it('resetSaved clears the saved flag', async () => {
    mockPut.mockResolvedValue({ data: {} });
    const { result } = renderHook(() => useSaveKnowledgeBase());

    await act(async () => { await result.current.saveKnowledgeBase('p', 't'); });
    expect(result.current.saved).toBe(true);

    act(() => { result.current.resetSaved(); });
    expect(result.current.saved).toBe(false);
  });
});
