/**
 * How a failed Business Info save is reported.
 *
 * The distinction that matters: a 403 is an AUTHORIZATION OUTCOME, not a
 * defect. `PUT /pages/:id` is `requireRole('admin')`, so a `member` — or
 * anyone demoted or removed mid-session — will legitimately be refused. Before
 * this fix only `WORKSPACE_ACCESS_DENIED` was recognised; `INSUFFICIENT_ROLE`
 * fell through to the generic "Failed to save. Please try again." AND filed a
 * Sentry error, so the merchant learned nothing and every refusal looked like
 * a bug in the error tracker.
 *
 * The errors here are REAL `AxiosError`s. The classifier the hook now shares
 * with the fact-list and single-fact saves reaches for `axios.isAxiosError`,
 * so a hand-rolled `{ response: … }` literal would be classified as "not an
 * API error at all" and the suite would pass while production did the opposite.
 */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AxiosError, type AxiosResponse } from 'axios';
import pagesEn from '@/i18n/en/pages.json';
import { useSaveKnowledgeBase } from '../useSaveKnowledgeBase';

const { put, toastError, captureError, addErrorBreadcrumb } = vi.hoisted(() => ({
  put: vi.fn(),
  toastError: vi.fn(),
  captureError: vi.fn(),
  addErrorBreadcrumb: vi.fn(),
}));

vi.mock('@/lib/api', () => ({ api: { put } }));
vi.mock('sonner', () => ({ toast: { error: toastError, success: vi.fn() } }));
vi.mock('@/lib/sentryHelpers', async (importOriginal) => ({
  // getBackendErrorCode / getStatusCode are the real ones: they are what the
  // shared classifier calls, so stubbing them would test nothing.
  ...(await importOriginal<typeof import('@/lib/sentryHelpers')>()),
  captureError,
  addErrorBreadcrumb,
}));

/** A genuine axios rejection, the shape the API layer really throws. */
function apiError(status: number, code?: string) {
  return new AxiosError(
    `Request failed with status code ${status}`,
    'ERR_BAD_REQUEST',
    undefined,
    undefined,
    { status, data: code ? { code } : {}, statusText: '', headers: {}, config: {} } as AxiosResponse,
  );
}

const TEXT = 'نص معلومات النشاط';

/** Drive one save. Returns the outcome plus the live hook result and the
 *  onSuccess spy, so a test can assert on either without a second helper. */
async function saveWith(onSuccess?: (pageId: string, text: string) => void) {
  const { result } = renderHook(() => useSaveKnowledgeBase(onSuccess));
  let outcome: { ok: boolean } | undefined;
  await act(async () => {
    outcome = await result.current.saveKnowledgeBase('page-1', TEXT);
  });
  return { outcome, result };
}

const save = async () => (await saveWith()).outcome;

beforeEach(() => vi.clearAllMocks());

describe('useSaveKnowledgeBase — the save itself', () => {
  it('PUTs the text, reports saved, and notifies the caller', async () => {
    put.mockResolvedValue({ data: {} });
    const onSuccess = vi.fn();

    const { outcome, result } = await saveWith(onSuccess);

    expect(put).toHaveBeenCalledWith('/pages/page-1', { knowledgeBase: TEXT });
    expect(outcome).toEqual({ ok: true, kbWarnings: undefined });
    expect(onSuccess).toHaveBeenCalledWith('page-1', TEXT);
    expect(result.current.saved).toBe(true);

    act(() => result.current.resetSaved());
    expect(result.current.saved).toBe(false);
  });

  it('a refused save notifies nobody and never claims to have saved', async () => {
    put.mockRejectedValue(apiError(403, 'INSUFFICIENT_ROLE'));
    const onSuccess = vi.fn();

    const { outcome, result } = await saveWith(onSuccess);

    // `{ ok: false }` is distinguishable from success-without-warnings (both
    // used to be `undefined`) — the catalog CTA gates its handoff on this.
    expect(outcome).toEqual({ ok: false });
    expect(onSuccess).not.toHaveBeenCalled();
    expect(result.current.saved).toBe(false);
  });
});

describe('useSaveKnowledgeBase — failure reporting', () => {
  it('403 INSUFFICIENT_ROLE: says who can change it, and files NO Sentry error', async () => {
    put.mockRejectedValue(apiError(403, 'INSUFFICIENT_ROLE'));

    expect(await save()).toEqual({ ok: false });
    expect(toastError).toHaveBeenCalledWith(pagesEn.saveFailedInsufficientRole);
    expect(captureError).not.toHaveBeenCalled();
  });

  it('403 WORKSPACE_ACCESS_DENIED: keeps its own message, still no Sentry error', async () => {
    put.mockRejectedValue(apiError(403, 'WORKSPACE_ACCESS_DENIED'));

    expect(await save()).toEqual({ ok: false });
    expect(toastError).toHaveBeenCalledWith(pagesEn.saveFailedAccessRevoked);
    expect(captureError).not.toHaveBeenCalled();
  });

  it('a refusal still leaves a trail — suppressing the error must not blind us', async () => {
    put.mockRejectedValue(apiError(403, 'INSUFFICIENT_ROLE'));

    await save();
    expect(addErrorBreadcrumb).toHaveBeenCalledWith(
      'authorization',
      expect.any(String),
      expect.objectContaining({ code: 'INSUFFICIENT_ROLE', pageId: 'page-1' }),
    );
  });

  it('a real failure (500) still reports generically AND files a Sentry error', async () => {
    put.mockRejectedValue(apiError(500));

    expect(await save()).toEqual({ ok: false });
    expect(toastError).toHaveBeenCalledWith(pagesEn.saveFailed);
    expect(captureError).toHaveBeenCalledOnce();
  });

  it('a 403 code we do not recognise is NOT silently swallowed', async () => {
    put.mockRejectedValue(apiError(403, 'SOME_FUTURE_CODE'));

    expect(await save()).toEqual({ ok: false });
    expect(toastError).toHaveBeenCalledWith(pagesEn.saveFailed);
    expect(captureError).toHaveBeenCalledOnce();
  });

  it('the same code on a NON-403 is a real failure, not an authorization outcome', async () => {
    put.mockRejectedValue(apiError(500, 'INSUFFICIENT_ROLE'));

    expect(await save()).toEqual({ ok: false });
    expect(toastError).toHaveBeenCalledWith(pagesEn.saveFailed);
    expect(captureError).toHaveBeenCalledOnce();
  });

  it('success returns ok with any kbWarnings the backend attached', async () => {
    const kbWarnings = { hasCatalog: true, reasons: ['price_list'], priceCount: 3 };
    put.mockResolvedValue({ data: { kbWarnings } });

    expect(await save()).toEqual({ ok: true, kbWarnings });
    expect(toastError).not.toHaveBeenCalled();
    expect(captureError).not.toHaveBeenCalled();
  });
});
