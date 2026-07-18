/**
 * Regression tests for useLeadAlertsEnabled (prod report 2026-07-19):
 * «تنبيهات العملاء المحتملين الجدد» was off but the merchant kept getting
 * lead notifications — the backend gated the push, but the in-app SSE toasts
 * read no setting at all. useSSE now gates its lead toasts on this hook.
 */
import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useLeadAlertsEnabled } from './useLeadAlertsEnabled';
import { settingsApi } from '@/lib/api';

vi.mock('@/lib/api', () => ({
  settingsApi: {
    get: vi.fn(),
  },
}));

const mockAuthState = { isAuthenticated: true };
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

describe('useLeadAlertsEnabled', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthState.isAuthenticated = true;
  });

  it('returns false when the merchant muted lead alerts', async () => {
    vi.mocked(settingsApi.get).mockResolvedValue({ data: { newLeadAlertsEnabled: false } } as never);
    const { result } = renderHook(() => useLeadAlertsEnabled(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current).toBe(false));
  });

  it('returns true when alerts are on', async () => {
    vi.mocked(settingsApi.get).mockResolvedValue({ data: { newLeadAlertsEnabled: true } } as never);
    const { result } = renderHook(() => useLeadAlertsEnabled(), { wrapper: makeWrapper() });
    await waitFor(() => expect(settingsApi.get).toHaveBeenCalled());
    expect(result.current).toBe(true);
  });

  it('defaults to true while loading and when the field is absent (matches DB default)', async () => {
    vi.mocked(settingsApi.get).mockResolvedValue({ data: {} } as never);
    const { result } = renderHook(() => useLeadAlertsEnabled(), { wrapper: makeWrapper() });
    expect(result.current).toBe(true); // during load
    await waitFor(() => expect(settingsApi.get).toHaveBeenCalled());
    expect(result.current).toBe(true); // absent field
  });

  it('does not fetch when unauthenticated (public pages mount useSSE via _app)', async () => {
    mockAuthState.isAuthenticated = false;
    const { result } = renderHook(() => useLeadAlertsEnabled(), { wrapper: makeWrapper() });
    expect(result.current).toBe(true);
    await new Promise((r) => setTimeout(r, 20));
    expect(settingsApi.get).not.toHaveBeenCalled();
  });
});
