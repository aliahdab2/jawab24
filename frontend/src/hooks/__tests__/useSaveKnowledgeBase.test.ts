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
 */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useSaveKnowledgeBase } from '../useSaveKnowledgeBase';

const { put, toastError, captureError } = vi.hoisted(() => ({
  put: vi.fn(),
  toastError: vi.fn(),
  captureError: vi.fn(),
}));

vi.mock('@/lib/api', () => ({ api: { put } }));
vi.mock('sonner', () => ({ toast: { error: toastError, success: vi.fn() } }));
vi.mock('@/lib/sentryHelpers', () => ({ captureError }));

/** Shaped like the ApiError the axios layer surfaces. */
function apiError(status: number, code?: string) {
  return { response: { status, data: code ? { code } : {} } };
}

async function save() {
  const { result } = renderHook(() => useSaveKnowledgeBase());
  let outcome: { ok: boolean } | undefined;
  await act(async () => {
    outcome = await result.current.saveKnowledgeBase('page-1', 'نص معلومات النشاط');
  });
  return outcome;
}

beforeEach(() => vi.clearAllMocks());

describe('useSaveKnowledgeBase — failure reporting', () => {
  it('403 INSUFFICIENT_ROLE: says who can change it, and files NO Sentry error', async () => {
    put.mockRejectedValue(apiError(403, 'INSUFFICIENT_ROLE'));

    expect(await save()).toEqual({ ok: false });
    expect(toastError).toHaveBeenCalledWith(
      'Only an owner or admin can change Business Info. Ask a workspace admin to update it.',
    );
    expect(captureError).not.toHaveBeenCalled();
  });

  it('403 WORKSPACE_ACCESS_DENIED: keeps its own message, still no Sentry error', async () => {
    put.mockRejectedValue(apiError(403, 'WORKSPACE_ACCESS_DENIED'));

    expect(await save()).toEqual({ ok: false });
    expect(toastError).toHaveBeenCalledWith(
      'Your access to this workspace was revoked. Please contact the workspace owner.',
    );
    expect(captureError).not.toHaveBeenCalled();
  });

  it('a real failure (500) still reports generically AND files a Sentry error', async () => {
    put.mockRejectedValue(apiError(500));

    expect(await save()).toEqual({ ok: false });
    expect(toastError).toHaveBeenCalledWith('Failed to save. Please try again.');
    expect(captureError).toHaveBeenCalledOnce();
  });

  it('a 403 code we do not recognise is NOT silently swallowed', async () => {
    put.mockRejectedValue(apiError(403, 'SOME_FUTURE_CODE'));

    expect(await save()).toEqual({ ok: false });
    expect(toastError).toHaveBeenCalledWith('Failed to save. Please try again.');
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
