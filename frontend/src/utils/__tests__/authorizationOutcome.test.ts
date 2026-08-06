/**
 * The one place that decides "was this refusal the system working, or a bug?"
 *
 * Three surfaces depend on this verdict (Business Info save, the fact-list
 * writes, the single-fact save) and all three use it to decide whether to file
 * a Sentry error. Getting it wrong in either direction is expensive: too loose
 * and real failures go unreported, too strict and every ordinary `member`
 * refusal looks like a defect in the tracker — which is the bug this shipped to
 * fix.
 */
import { describe, it, expect } from 'vitest';
import { AxiosError, type AxiosResponse } from 'axios';
import commonEn from '@/i18n/en/common.json';
import commonAr from '@/i18n/ar/common.json';
import { authorizationOutcome, AUTHORIZATION_MESSAGE_KEY } from '../authorizationOutcome';

function axiosFailure(status: number, code?: string) {
  return new AxiosError('Request failed', 'ERR_BAD_REQUEST', undefined, undefined, {
    status, data: code ? { code } : {}, statusText: '', headers: {}, config: {},
  } as AxiosResponse);
}

describe('authorizationOutcome', () => {
  it('recognises both codes the workspace guards return', () => {
    expect(authorizationOutcome(axiosFailure(403, 'INSUFFICIENT_ROLE'))).toBe('INSUFFICIENT_ROLE');
    expect(authorizationOutcome(axiosFailure(403, 'WORKSPACE_ACCESS_DENIED'))).toBe('WORKSPACE_ACCESS_DENIED');
  });

  it('requires the 403 — the same code on another status is a real failure', () => {
    expect(authorizationOutcome(axiosFailure(500, 'INSUFFICIENT_ROLE'))).toBeUndefined();
  });

  it('does not claim 403s it has no message for', () => {
    // WORKSPACE_REQUIRED is also a 403 from the same middleware, but it means
    // the CLIENT sent no workspace context — a defect, and it must keep
    // reaching Sentry.
    expect(authorizationOutcome(axiosFailure(403, 'WORKSPACE_REQUIRED'))).toBeUndefined();
    expect(authorizationOutcome(axiosFailure(403))).toBeUndefined();
  });

  it('is not fooled by non-axios throws', () => {
    expect(authorizationOutcome(new Error('boom'))).toBeUndefined();
    expect(authorizationOutcome({ response: { status: 403, data: { code: 'INSUFFICIENT_ROLE' } } })).toBeUndefined();
    expect(authorizationOutcome(undefined)).toBeUndefined();
  });

  it('every outcome resolves to real copy in BOTH locales', () => {
    // `translation:validate` checks en/ar parity, not that a key a map points
    // at exists at all — so a new code added here with no string would ship a
    // raw `common.errSomething` into a merchant's face. This closes that.
    for (const outcome of ['INSUFFICIENT_ROLE', 'WORKSPACE_ACCESS_DENIED'] as const) {
      const key = AUTHORIZATION_MESSAGE_KEY[outcome];
      expect(commonEn[key as keyof typeof commonEn]).toBeTruthy();
      expect(commonAr[key as keyof typeof commonAr]).toBeTruthy();
    }
  });
});
