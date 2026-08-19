/**
 * Regression tests for useDashboardLanguageSync.
 *
 * The header language toggle only started writing `settings.dashboard_language`
 * on 2026-08-19 (#831), and its PUT is fire-and-forget, so a large installed
 * base reads the dashboard in one language while the column — the ONLY language
 * signal a server-side push or email has — still says the other. Reported from
 * the Android app: an English Settings screen with «العربية» selected.
 */
import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useDashboardLanguageSync } from './useDashboardLanguageSync';
import { SETTINGS_QUERY_KEY } from './useSettingsQuery';
import { settingsApi } from '@/lib/api';
import { intlState } from '@/__tests__/testUtils/intlState';

/**
 * Let the query resolve AND the effect it triggers run. A negative assertion
 * fired the moment `settingsApi.get` resolves proves nothing — the write it
 * denies has not had a chance to happen yet, so the test passed even with the
 * guard it exists to pin removed (caught by mutation).
 */
async function settle() {
  await waitFor(() => expect(settingsApi.get).toHaveBeenCalled());
  await flush();
}

/** A macrotask inside act(), so the render it may trigger is not a stray update. */
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

vi.mock('@/lib/api', () => ({
  settingsApi: {
    get: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('@/lib/sentryHelpers', () => ({
  captureError: vi.fn(),
}));

const mockAuthState = { isAuthenticated: true, user: { facebookId: 'fb-1' } as { facebookId: string } | null };
const mockUIState = { language: 'en' };
vi.mock('@/lib/store', () => ({
  useAuthStore: (selector: (s: typeof mockAuthState) => unknown) => selector(mockAuthState),
  useUIStore: (selector: (s: typeof mockUIState) => unknown) => selector(mockUIState),
}));

function makeWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  }
  return { Wrapper, queryClient };
}

describe('useDashboardLanguageSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    intlState.locale = 'en';
    mockAuthState.isAuthenticated = true;
    mockAuthState.user = { facebookId: 'fb-1' };
  });

  it('mirrors the language the merchant is reading into a stale stored column', async () => {
    vi.mocked(settingsApi.get).mockResolvedValue({ data: { dashboardLanguage: 'ar' } } as never);
    vi.mocked(settingsApi.update).mockResolvedValue({ data: {} } as never);
    const { Wrapper } = makeWrapper();

    renderHook(() => useDashboardLanguageSync(), { wrapper: Wrapper });

    await waitFor(() => expect(settingsApi.update).toHaveBeenCalledWith({ dashboardLanguage: 'en' }));
  });

  it('patches ONLY the language — a stored field that fails the settings schema must not block the heal', async () => {
    vi.mocked(settingsApi.get).mockResolvedValue({ data: { dashboardLanguage: 'ar' } } as never);
    vi.mocked(settingsApi.update).mockResolvedValue({ data: {} } as never);
    const { Wrapper } = makeWrapper();

    renderHook(() => useDashboardLanguageSync(), { wrapper: Wrapper });

    await waitFor(() => expect(settingsApi.update).toHaveBeenCalledTimes(1));
    expect(Object.keys(vi.mocked(settingsApi.update).mock.calls[0][0] as object)).toEqual(['dashboardLanguage']);
  });

  it('writes nothing when the stored column already matches', async () => {
    vi.mocked(settingsApi.get).mockResolvedValue({ data: { dashboardLanguage: 'en' } } as never);
    const { Wrapper } = makeWrapper();

    renderHook(() => useDashboardLanguageSync(), { wrapper: Wrapper });

    await settle();
    expect(settingsApi.update).not.toHaveBeenCalled();
  });

  it('writes nothing when the settings response carries no language', async () => {
    vi.mocked(settingsApi.get).mockResolvedValue({ data: {} } as never);
    const { Wrapper } = makeWrapper();

    renderHook(() => useDashboardLanguageSync(), { wrapper: Wrapper });

    await settle();
    expect(settingsApi.update).not.toHaveBeenCalled();
  });

  it('writes once per language even as the hook re-renders, and leaves the shared cache on the healed value', async () => {
    vi.mocked(settingsApi.get).mockResolvedValue({ data: { dashboardLanguage: 'ar' } } as never);
    vi.mocked(settingsApi.update).mockResolvedValue({ data: {} } as never);
    const { Wrapper, queryClient } = makeWrapper();

    const { rerender } = renderHook(() => useDashboardLanguageSync(), { wrapper: Wrapper });
    await waitFor(() => expect(settingsApi.update).toHaveBeenCalledTimes(1));
    rerender();
    rerender();

    expect(settingsApi.update).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(queryClient.getQueryData(SETTINGS_QUERY_KEY)).toMatchObject({ dashboardLanguage: 'en' }),
    );
  });

  // The demo user row is shared by every demo visitor and re-seeded with the
  // visitor's locale on arrival — healing it writes one visitor's language onto
  // the next one's row.
  it('never writes for the shared demo session', async () => {
    mockAuthState.user = { facebookId: 'demo_123' };
    vi.mocked(settingsApi.get).mockResolvedValue({ data: { dashboardLanguage: 'ar' } } as never);
    const { Wrapper } = makeWrapper();

    renderHook(() => useDashboardLanguageSync(), { wrapper: Wrapper });

    await settle();
    expect(settingsApi.update).not.toHaveBeenCalled();
  });

  it('does not fetch or write without a session', async () => {
    mockAuthState.isAuthenticated = false;
    const { Wrapper } = makeWrapper();

    renderHook(() => useDashboardLanguageSync(), { wrapper: Wrapper });

    await flush();
    expect(settingsApi.get).not.toHaveBeenCalled();
    expect(settingsApi.update).not.toHaveBeenCalled();
  });
});
