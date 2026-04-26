import { describe, it, expect } from 'vitest';
import axios, { type AxiosError } from 'axios';
import { getBackendErrorCode } from './sentryHelpers';

describe('getBackendErrorCode', () => {
  it('extracts code from an axios error response.data.code', () => {
    const err = {
      isAxiosError: true,
      response: { data: { code: 'DM_PLATFORM_AUTH', message: 'token expired' } },
    } as unknown as AxiosError;
    Object.setPrototypeOf(err, axios.AxiosError.prototype);
    expect(getBackendErrorCode(err)).toBe('DM_PLATFORM_AUTH');
  });

  it('extracts backendCode from a plain Error with backendCode property', () => {
    const err = new Error('Invalid or expired token') as Error & { backendCode?: string };
    err.backendCode = 'INVALID_TOKEN';
    expect(getBackendErrorCode(err)).toBe('INVALID_TOKEN');
  });

  it('returns undefined for an axios error without a code field', () => {
    const err = {
      isAxiosError: true,
      response: { data: { message: 'huh' } },
    } as unknown as AxiosError;
    Object.setPrototypeOf(err, axios.AxiosError.prototype);
    expect(getBackendErrorCode(err)).toBeUndefined();
  });

  it('returns undefined for a plain Error without backendCode', () => {
    expect(getBackendErrorCode(new Error('whatever'))).toBeUndefined();
  });

  it('returns undefined for non-Error values', () => {
    expect(getBackendErrorCode('a string')).toBeUndefined();
    expect(getBackendErrorCode(null)).toBeUndefined();
    expect(getBackendErrorCode(undefined)).toBeUndefined();
    expect(getBackendErrorCode({ code: 'NOPE' })).toBeUndefined();
  });

  it('ignores non-string backendCode values', () => {
    const err = new Error('x') as Error & { backendCode?: unknown };
    (err as { backendCode: unknown }).backendCode = 42;
    expect(getBackendErrorCode(err as Error)).toBeUndefined();
  });
});
