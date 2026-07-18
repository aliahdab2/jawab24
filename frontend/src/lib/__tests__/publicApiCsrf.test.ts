/**
 * Regression tests for the publicApi CSRF interceptor (lib/api.ts).
 *
 * Incident 2026-07-18: publicApi rides the session cookie (withCredentials)
 * but never attached X-CSRF-Token, so its mutations (logout, waitlist) 403'd
 * whenever a `token` cookie was present.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { AxiosRequestConfig } from 'axios';
import { publicApi, api } from '../api';

function captureAdapter(captured: { config?: AxiosRequestConfig }) {
  return async (config: AxiosRequestConfig) => {
    captured.config = config;
    return { data: {}, status: 200, statusText: 'OK', headers: {}, config };
  };
}

function clearCsrfCookie() {
  document.cookie = 'csrfToken=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
}

describe('CSRF header interceptors', () => {
  beforeEach(() => {
    clearCsrfCookie();
  });

  it('publicApi attaches X-CSRF-Token on POST when the csrfToken cookie is readable', async () => {
    document.cookie = 'csrfToken=test-csrf-123';
    const captured: { config?: AxiosRequestConfig } = {};
    await publicApi.post('/auth/logout', undefined, { adapter: captureAdapter(captured) });
    expect(captured.config?.headers?.['X-CSRF-Token']).toBe('test-csrf-123');
  });

  it('publicApi does not attach the header on GET', async () => {
    document.cookie = 'csrfToken=test-csrf-123';
    const captured: { config?: AxiosRequestConfig } = {};
    await publicApi.get('/auth/demo/status', { adapter: captureAdapter(captured) });
    expect(captured.config?.headers?.['X-CSRF-Token']).toBeUndefined();
  });

  it('publicApi sends no header when the cookie is absent (native app / logged out)', async () => {
    const captured: { config?: AxiosRequestConfig } = {};
    await publicApi.post('/auth/demo', { locale: 'ar' }, { adapter: captureAdapter(captured) });
    expect(captured.config?.headers?.['X-CSRF-Token']).toBeUndefined();
  });

  it('authenticated api instance still attaches X-CSRF-Token on mutations', async () => {
    document.cookie = 'csrfToken=test-csrf-456';
    const captured: { config?: AxiosRequestConfig } = {};
    await api.post('/settings', {}, { adapter: captureAdapter(captured) });
    expect(captured.config?.headers?.['X-CSRF-Token']).toBe('test-csrf-456');
  });
});
