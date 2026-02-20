import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useVersion } from '@/lib/useVersion';

describe('useVersion', () => {
  const originalEnv = process.env.NEXT_PUBLIC_APP_VERSION;
  const originalApiUrl = process.env.NEXT_PUBLIC_API_URL;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_URL = 'http://localhost:4000/api';
    vi.restoreAllMocks();
  });

  afterEach(() => {
    // Restore original env
    if (originalEnv !== undefined) {
      process.env.NEXT_PUBLIC_APP_VERSION = originalEnv;
    } else {
      delete process.env.NEXT_PUBLIC_APP_VERSION;
    }
    if (originalApiUrl !== undefined) {
      process.env.NEXT_PUBLIC_API_URL = originalApiUrl;
    }
  });

  it('should start with loading=true', () => {
    vi.spyOn(global, 'fetch').mockImplementation(
      () => new Promise(() => {}) // never resolves
    );

    const { result } = renderHook(() => useVersion());
    expect(result.current.loading).toBe(true);
  });

  it('should use NEXT_PUBLIC_APP_VERSION when set', async () => {
    process.env.NEXT_PUBLIC_APP_VERSION = '2.1.0';
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        version: 'abc123',
        shortVersion: 'abc123',
        deployedAt: '2026-02-20',
        environment: 'production',
      }),
    } as Response);

    const { result } = renderHook(() => useVersion());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Should prefer the env variable over API shortVersion
    expect(result.current.displayVersion).toBe('2.1.0');
  });

  it('should fall back to API shortVersion when env is not set', async () => {
    delete process.env.NEXT_PUBLIC_APP_VERSION;
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        version: 'abc123def',
        shortVersion: 'abc123d',
        deployedAt: '2026-02-20',
        environment: 'production',
      }),
    } as Response);

    const { result } = renderHook(() => useVersion());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.displayVersion).toBe('abc123d');
    expect(result.current.environment).toBe('production');
  });

  it('should show "unknown" when both env and API are unavailable', async () => {
    delete process.env.NEXT_PUBLIC_APP_VERSION;
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useVersion());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.displayVersion).toBe('unknown');
    expect(result.current.environment).toBe('unknown');
  });

  it('should handle non-ok API response gracefully', async () => {
    delete process.env.NEXT_PUBLIC_APP_VERSION;
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
    } as Response);

    const { result } = renderHook(() => useVersion());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.displayVersion).toBe('unknown');
    expect(result.current.versionInfo).toBeNull();
  });

  it('should expose full versionInfo from API', async () => {
    process.env.NEXT_PUBLIC_APP_VERSION = '2.1.0';
    const apiData = {
      version: 'abc123def456',
      shortVersion: 'abc123d',
      deployedAt: '2026-02-20T10:30:00Z',
      environment: 'production',
    };
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => apiData,
    } as Response);

    const { result } = renderHook(() => useVersion());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.versionInfo).toEqual(apiData);
  });
});
