import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, render, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { Comment } from '@jawab24/shared';

vi.mock('@/lib/api', () => ({
  postsApi: { getById: vi.fn() },
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
vi.mock('@/lib/sentryHelpers', () => ({ captureError: vi.fn() }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
// The hook renders the config modal via next/dynamic; stub it so the test doesn't
// pull the real component. The stub captures the `onSaved` prop so a test can invoke
// the hook's save-invalidation flow without the real modal.
const mockModal: { onSaved: (() => void) | null } = { onSaved: null };
vi.mock('@/components/comments/PostTriggerModal', () => ({
  PostTriggerModal: (props: { onSaved: () => void }) => {
    mockModal.onSaved = props.onSaved;
    return null;
  },
}));

import { usePostReplySetup } from '@/hooks/usePostReplySetup';
import { postsApi } from '@/lib/api';
import { toast } from 'sonner';

const getById = vi.mocked(postsApi.getById);

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  Wrapper.displayName = 'TestWrapper';
  return Wrapper;
}

const comment = (over: Partial<Comment> = {}): Comment =>
  ({ id: 'c1', postId: 'p1', source: 'facebook', message: 'hi', postMessage: 'a post' , ...over }) as unknown as Comment;

describe('usePostReplySetup', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does nothing for a comment with no post (returns false, no fetch, no modal)', async () => {
    const { result } = renderHook(() => usePostReplySetup(), { wrapper: makeWrapper() });
    let ret: boolean | undefined;
    await act(async () => { ret = await result.current.open(comment({ postId: null as unknown as string })); });
    expect(ret).toBe(false);
    expect(getById).not.toHaveBeenCalled();
    expect(result.current.modal).toBeNull();
  });

  it('fetches the post first and opens the config modal on success', async () => {
    getById.mockResolvedValue({ data: { triggerKeyword: 'register', triggerReply: 'Thanks!' } } as never);
    const { result } = renderHook(() => usePostReplySetup(), { wrapper: makeWrapper() });
    let ret: boolean | undefined;
    await act(async () => { ret = await result.current.open(comment()); });
    expect(ret).toBe(true);
    // Fetched the existing trigger (this is what prevents a blank-overwrite of a
    // configured post) before opening.
    expect(getById).toHaveBeenCalledWith('p1');
    expect(result.current.modal).not.toBeNull();
  });

  it('returns false and surfaces an error toast when the fetch fails', async () => {
    getById.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => usePostReplySetup(), { wrapper: makeWrapper() });
    let ret: boolean | undefined;
    await act(async () => { ret = await result.current.open(comment()); });
    expect(ret).toBe(false);
    expect(toast.error).toHaveBeenCalled();
    expect(result.current.modal).toBeNull();
  });

  it('close() dismisses the config modal', async () => {
    getById.mockResolvedValue({ data: {} } as never);
    const { result } = renderHook(() => usePostReplySetup(), { wrapper: makeWrapper() });
    await act(async () => { await result.current.open(comment()); });
    expect(result.current.modal).not.toBeNull();
    act(() => { result.current.close(); });
    expect(result.current.modal).toBeNull();
  });

  it('onSaved invalidates posts, post-trigger AND published-posts (the picker badge)', async () => {
    // Regression: the picker's `hasTrigger` badge (مفعّل/إعداد) reads `published-posts`.
    // If a save doesn't invalidate it, the badge stays stale until a full page reload
    // (global 5-min staleTime).
    getById.mockResolvedValue({ data: {} } as never);
    mockModal.onSaved = null;

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    // A component that both drives the hook and renders its modal node, so the stubbed
    // PostTriggerModal actually mounts and hands us its `onSaved` prop.
    let api: ReturnType<typeof usePostReplySetup> | null = null;
    function Harness() {
      api = usePostReplySetup();
      return <>{api.modal}</>;
    }
    render(
      <QueryClientProvider client={qc}>
        <Harness />
      </QueryClientProvider>,
    );

    await act(async () => { await api!.open(comment()); });
    await waitFor(() => expect(mockModal.onSaved).toBeTypeOf('function'));

    act(() => { mockModal.onSaved!(); });

    const keys = invalidateSpy.mock.calls.map((c) => (c[0] as { queryKey: string[] }).queryKey[0]);
    expect(keys).toContain('posts');
    expect(keys).toContain('post-trigger');
    expect(keys).toContain('published-posts');
  });
});
