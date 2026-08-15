/**
 * Regression tests for useWorkspacesRefresh (prod report 2026-08-03):
 * workspace-membership state read from the persisted store was written only
 * at login, so anything granted AFTER a user's last login (new workspaces,
 * membership-driven gates) never reached standing sessions. This hook
 * refreshes the snapshot from GET /workspaces once per app load.
 */
import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useWorkspacesRefresh } from '../useWorkspacesRefresh';
import { workspaceApi } from '@/lib/api';

vi.mock('@/lib/api', () => ({
  workspaceApi: {
    list: vi.fn(),
  },
}));

const mockSetWorkspaces = vi.fn();
const mockAuthState = {
  _hasHydrated: true,
  isAuthenticated: true,
  user: { id: 'user-1' } as { id: string } | null,
  setWorkspaces: mockSetWorkspaces,
};
vi.mock('@/lib/store', () => ({
  useAuthStore: (selector: (s: typeof mockAuthState) => unknown) => selector(mockAuthState),
}));

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  }
  return Wrapper;
}

const FOUNDER_WS = { id: 'a0005407-92bf-473e-9368-013f14c57a7d', name: 'Jawab24', role: 'member' };

describe('useWorkspacesRefresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthState._hasHydrated = true;
    mockAuthState.isAuthenticated = true;
    mockAuthState.user = { id: 'user-1' };
  });

  it('writes the fresh server list into the store (the stale-gate fix)', async () => {
    vi.mocked(workspaceApi.list).mockResolvedValue({ data: [FOUNDER_WS] } as never);
    renderHook(() => useWorkspacesRefresh(), { wrapper: makeWrapper() });
    await waitFor(() => expect(mockSetWorkspaces).toHaveBeenCalledWith([FOUNDER_WS]));
  });

  it('does not fetch while unauthenticated', async () => {
    mockAuthState.isAuthenticated = false;
    vi.mocked(workspaceApi.list).mockResolvedValue({ data: [FOUNDER_WS] } as never);
    renderHook(() => useWorkspacesRefresh(), { wrapper: makeWrapper() });
    await new Promise((r) => setTimeout(r, 10));
    expect(workspaceApi.list).not.toHaveBeenCalled();
    expect(mockSetWorkspaces).not.toHaveBeenCalled();
  });

  it('does not fetch before the persisted store has hydrated', async () => {
    mockAuthState._hasHydrated = false;
    vi.mocked(workspaceApi.list).mockResolvedValue({ data: [FOUNDER_WS] } as never);
    renderHook(() => useWorkspacesRefresh(), { wrapper: makeWrapper() });
    await new Promise((r) => setTimeout(r, 10));
    expect(workspaceApi.list).not.toHaveBeenCalled();
  });

  it('never wipes the persisted list on an empty response', async () => {
    vi.mocked(workspaceApi.list).mockResolvedValue({ data: [] } as never);
    renderHook(() => useWorkspacesRefresh(), { wrapper: makeWrapper() });
    await waitFor(() => expect(workspaceApi.list).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 10));
    expect(mockSetWorkspaces).not.toHaveBeenCalled();
  });

  it('never writes the store when the fetch fails', async () => {
    vi.mocked(workspaceApi.list).mockRejectedValue(new Error('network'));
    renderHook(() => useWorkspacesRefresh(), { wrapper: makeWrapper() });
    await waitFor(() => expect(workspaceApi.list).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 10));
    expect(mockSetWorkspaces).not.toHaveBeenCalled();
  });

  it('refetches for a different user id — a cached list cannot cross an account switch', async () => {
    vi.mocked(workspaceApi.list).mockResolvedValue({ data: [FOUNDER_WS] } as never);
    const wrapper = makeWrapper();
    const { rerender } = renderHook(() => useWorkspacesRefresh(), { wrapper });
    await waitFor(() => expect(workspaceApi.list).toHaveBeenCalledTimes(1));

    mockAuthState.user = { id: 'user-2' };
    rerender();
    await waitFor(() => expect(workspaceApi.list).toHaveBeenCalledTimes(2));
  });
});
