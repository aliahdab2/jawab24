/**
 * Hermetic Axios test double.
 *
 * `authManager.setupAuthInterceptor()` uses an Axios instance three ways:
 *   1. `instance.interceptors.response.use(onFulfilled, onRejected)` — install
 *   2. `instance.post('/auth/refresh')`                              — refresh
 *   3. `instance(originalRequest)`                                   — RETRY
 *
 * (3) is why this file exists. A test built on a real `axios.create()` leaves
 * the retry call live: jsdom resolves the relative `/api/test` against its
 * document origin and issues an actual XHR. That passed only by accident —
 * nothing was listening, so the connection was refused instantly. Start any dev
 * server on jsdom's default origin (port 3000) and every refresh-succeeds test
 * hangs until the 20s vitest timeout instead (five reds in `test:coverage`,
 * 2026-08-04). Mocking `.post` alone does not help: `.post` is the refresh, not
 * the retry.
 *
 * So the double is a callable `vi.fn()` — the retry resolves in-process and
 * there is no adapter to fall through to. Unit tests here assert on
 * AuthManager's control flow (queueing, `_retry`, logout), never on HTTP, so no
 * real transport is wanted. Pair with the pinned jsdom origin in
 * `vitest.config.ts`, which stops any *other* suite reaching a live dev server.
 */

import { vi, type Mock } from 'vitest';
import type { AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from 'axios';

/** Request config as the interceptor sees it — Axios' own, plus the retry marker. */
export type RetryableRequestConfig = InternalAxiosRequestConfig & { _retry?: boolean };

/** Handlers captured from `interceptors.response.use(...)`. */
export interface ResponseInterceptorCapture {
  onFulfilled: (response: AxiosResponse) => AxiosResponse | Promise<AxiosResponse>;
  onRejected: (error: unknown) => unknown;
}

export interface MockAxios {
  /** Pass to production code that expects an `AxiosInstance`. */
  readonly instance: AxiosInstance;
  /** The instance called as a function — i.e. the retried original request. */
  readonly retry: Mock<(config: RetryableRequestConfig) => Promise<AxiosResponse>>;
  /** `instance.post(...)` — the `/auth/refresh` call. */
  readonly post: Mock;
  /** `instance.interceptors.response.use` — assert installation. */
  readonly use: Mock;
  /**
   * Handlers the production code installed. Reading a handler before
   * `setupAuthInterceptor()` has run throws rather than yielding `undefined`,
   * so a mis-ordered test fails with a clear message instead of a TypeError.
   */
  readonly response: ResponseInterceptorCapture;
}

/** A minimal successful response — enough for code that only awaits the retry. */
function okResponse(config: RetryableRequestConfig): AxiosResponse {
  return {
    data: {},
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
  } as AxiosResponse;
}

/**
 * Build a callable Axios double. Every method is a `vi.fn()`, so tests override
 * behaviour with `mock.post.mockResolvedValue(...)` and assert with
 * `expect(mock.post).toHaveBeenCalledWith('/auth/refresh')`.
 */
export function createMockAxios(): MockAxios {
  const retry: MockAxios['retry'] = vi.fn((config: RetryableRequestConfig) =>
    Promise.resolve(okResponse(config)),
  );

  // Default: refresh succeeds. Tests that need failure override it.
  const post = vi.fn().mockResolvedValue({ data: { success: true } });

  const captured: Partial<ResponseInterceptorCapture> = {};
  const use = vi.fn(
    (
      onFulfilled?: ResponseInterceptorCapture['onFulfilled'] | null,
      onRejected?: ResponseInterceptorCapture['onRejected'] | null,
    ) => {
      if (onFulfilled) captured.onFulfilled = onFulfilled;
      if (onRejected) captured.onRejected = onRejected;
      return 0; // Axios returns a handler id
    },
  );

  // The double IS the callable, so `instance(config)` is the retry mock itself.
  const callable = retry as unknown as AxiosInstance & Record<string, unknown>;
  callable.post = post;
  callable.interceptors = {
    request: { use: vi.fn(), eject: vi.fn(), clear: vi.fn() },
    response: { use, eject: vi.fn(), clear: vi.fn() },
  } as unknown as AxiosInstance['interceptors'];
  callable.defaults = { headers: {} } as unknown as AxiosInstance['defaults'];

  const response: ResponseInterceptorCapture = {
    get onFulfilled() {
      if (!captured.onFulfilled) {
        throw new Error('No response interceptor installed — call setupAuthInterceptor() first');
      }
      return captured.onFulfilled;
    },
    get onRejected() {
      if (!captured.onRejected) {
        throw new Error('No error interceptor installed — call setupAuthInterceptor() first');
      }
      return captured.onRejected;
    },
  };

  return { instance: callable as AxiosInstance, retry, post, use, response };
}

/**
 * Build the AxiosError shape the interceptor destructures: a `status` and the
 * `config` it will mark with `_retry` and hand back to the retry call.
 *
 * The returned `config` IS the object passed in (only a missing `headers` is
 * filled, since the 403 workspace path does `delete headers['X-Workspace-Id']`).
 * Identity is deliberate: the interceptor mutates the config it was handed, so
 * a test holding the reference can assert `_retry` was set on the real request
 * rather than on a copy.
 */
export function axiosErrorWith(
  status: number,
  config: Partial<RetryableRequestConfig> & { url?: string } = {},
  data?: unknown,
): { response: { status: number; data?: unknown }; config: RetryableRequestConfig } {
  const requestConfig = config as RetryableRequestConfig;
  requestConfig.headers = requestConfig.headers ?? ({} as RetryableRequestConfig['headers']);
  return {
    response: { status, ...(data === undefined ? {} : { data }) },
    config: requestConfig,
  };
}
