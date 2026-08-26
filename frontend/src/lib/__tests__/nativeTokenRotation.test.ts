/**
 * Regression tests: the refreshed access token must reach the retried request.
 *
 * Incident JAWAB24-FRONTEND-39 (2026-08-26). On native, `api`'s request
 * interceptor sends `localStorage.token` as a Bearer header, and the backend
 * PREFERS that header over the cookie (middleware/auth.ts authenticate()).
 * `authManager.refreshToken()` checked only `data.success` and discarded
 * `data.token`, and nothing else ever rewrote `localStorage.token` — so the
 * post-refresh retry re-sent the EXPIRED token, 401'd again, and the `_retry`
 * guard surfaced an AxiosError 401 to the caller. No logout fired (the refresh
 * itself kept succeeding), so a native session stayed in that loop forever.
 *
 * Measured in production: the demo account minted 41 refresh-token rotations in
 * a single minute (2026-08-26 07:21) doing exactly this, with zero terminal
 * revocations — the loop never self-terminated.
 *
 * The first test is the end-to-end proof: a fake server that rejects the stale
 * Bearer exactly as production does. It fails before the fix with the same
 * AxiosError 401 the merchant saw.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AxiosError, type AxiosRequestConfig, type AxiosResponse } from 'axios';

// Deterministic, in-memory persist storage: the real one resolves to the native
// SecureStorage plugin once `window.Capacitor` says native, which has no jsdom
// implementation. Persistence is not what these tests are about.
vi.mock('../zustandStorage', () => {
  const mem = new Map<string, string>();
  return {
    getPersistStorage: () =>
      Promise.resolve({
        getItem: (name: string) => mem.get(name) ?? null,
        setItem: (name: string, value: string) => { mem.set(name, value); },
        removeItem: (name: string) => { mem.delete(name); },
      }),
  };
});

const EXPIRED = 'expired-access-token';
const FRESH = 'freshly-rotated-access-token';

function setNative(isNative: boolean) {
  Object.defineProperty(window, 'Capacitor', {
    value: { isNativePlatform: () => isNative, getPlatform: () => (isNative ? 'android' : 'web') },
    writable: true,
    configurable: true,
  });
}

describe('native access-token rotation after /auth/refresh', () => {
  beforeEach(() => {
    localStorage.clear();
    setNative(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('retries the failed request with the ROTATED bearer, not the expired one', async () => {
    const { api } = await import('../api');
    const { useAuthStore } = await import('../store');

    useAuthStore.setState({ token: EXPIRED, isAuthenticated: true });
    localStorage.setItem('token', EXPIRED);

    const bearersSeen: string[] = [];

    /**
     * Fake server modelling the production rule: the request is judged by its
     * Authorization header alone. A refreshed cookie cannot rescue a request
     * that still carries the old Bearer — which is the whole bug.
     */
    const fakeServer = async (config: AxiosRequestConfig): Promise<AxiosResponse> => {
      const ok = (data: unknown): AxiosResponse => ({
        data, status: 200, statusText: 'OK', headers: {}, config: config as never,
      });

      if (config.url === '/auth/refresh') {
        return ok({ success: true, token: FRESH });
      }

      const bearer = String(config.headers?.Authorization ?? '').replace('Bearer ', '');
      bearersSeen.push(bearer);
      if (bearer !== FRESH) {
        throw new AxiosError(
          'Request failed with status code 401',
          AxiosError.ERR_BAD_REQUEST,
          config as never,
          null,
          { data: { code: 'INVALID_TOKEN' }, status: 401, statusText: 'Unauthorized', headers: {}, config: config as never },
        );
      }
      return ok({ senderId: 'sender-1', pageId: 'page-1' });
    };

    const previousAdapter = api.defaults.adapter;
    api.defaults.adapter = fakeServer;
    try {
      const response = await api.get('/messages/locate/abc');

      expect(response.status).toBe(200);
      // First attempt carried the expired token; the retry carried the fresh one.
      expect(bearersSeen).toEqual([EXPIRED, FRESH]);
    } finally {
      api.defaults.adapter = previousAdapter;
    }
  });

  it('refreshToken() hands the rotated token to the store', async () => {
    const { authManager } = await import('../authManager');
    const { useAuthStore } = await import('../store');

    const setToken = vi.spyOn(useAuthStore.getState(), 'setToken');
    const instance = { post: vi.fn().mockResolvedValue({ data: { success: true, token: FRESH } }) };

    const result = await authManager.refreshToken(instance as never);

    expect(result).toBe(true);
    expect(setToken).toHaveBeenCalledWith(FRESH);
  });

  it('still reports success when the server omits the token (older backend)', async () => {
    const { authManager } = await import('../authManager');
    const instance = { post: vi.fn().mockResolvedValue({ data: { success: true } }) };

    await expect(authManager.refreshToken(instance as never)).resolves.toBe(true);
  });

  it('does not adopt a token when the refresh reports failure', async () => {
    const { authManager } = await import('../authManager');
    const { useAuthStore } = await import('../store');

    const setToken = vi.spyOn(useAuthStore.getState(), 'setToken');
    const instance = { post: vi.fn().mockResolvedValue({ data: { success: false, token: FRESH } }) };

    await expect(authManager.refreshToken(instance as never)).resolves.toBe(false);
    expect(setToken).not.toHaveBeenCalled();
  });
});

describe('store.setToken', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('mirrors the token to localStorage on native, where the bearer is read from', async () => {
    setNative(true);
    const { useAuthStore } = await import('../store');

    useAuthStore.getState().setToken(FRESH);

    expect(localStorage.getItem('token')).toBe(FRESH);
    expect(useAuthStore.getState().token).toBe(FRESH);
  });

  it('never writes a localStorage token on web, which authenticates by HttpOnly cookie', async () => {
    setNative(false);
    const { useAuthStore } = await import('../store');

    useAuthStore.getState().setToken(FRESH);

    expect(localStorage.getItem('token')).toBeNull();
    expect(useAuthStore.getState().token).toBe(FRESH);
  });

  it('leaves user, workspaces and isAuthenticated untouched — it is not a login', async () => {
    setNative(true);
    const { useAuthStore } = await import('../store');

    const user = { id: 'u1', name: 'Merchant', email: 'm@example.com' };
    useAuthStore.setState({ user, isAuthenticated: true, activeWorkspaceId: 'ws-1' });

    useAuthStore.getState().setToken(FRESH);

    const state = useAuthStore.getState();
    expect(state.user).toEqual(user);
    expect(state.isAuthenticated).toBe(true);
    expect(state.activeWorkspaceId).toBe('ws-1');
  });

  it('ignores an empty or whitespace token instead of stranding a useless bearer', async () => {
    setNative(true);
    const { useAuthStore } = await import('../store');

    useAuthStore.setState({ token: EXPIRED });
    localStorage.setItem('token', EXPIRED);

    useAuthStore.getState().setToken('');
    useAuthStore.getState().setToken('   ');

    expect(localStorage.getItem('token')).toBe(EXPIRED);
    expect(useAuthStore.getState().token).toBe(EXPIRED);
  });
});
