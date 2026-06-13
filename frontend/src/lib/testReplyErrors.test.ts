import { describe, it, expect } from 'vitest';
import { classifyTestReplyError } from './testReplyErrors';

describe('classifyTestReplyError', () => {
  it('maps HTTP 429 to rateLimit', () => {
    expect(classifyTestReplyError({ response: { status: 429 } })).toBe('rateLimit');
  });

  it('maps 403 with AI_QUOTA_EXCEEDED to quota', () => {
    expect(classifyTestReplyError({ response: { status: 403, data: { code: 'AI_QUOTA_EXCEEDED' } } })).toBe('quota');
  });

  it('maps 403 without the quota code to generic', () => {
    expect(classifyTestReplyError({ response: { status: 403, data: { code: 'FORBIDDEN' } } })).toBe('generic');
  });

  it('maps network / 5xx / unknown errors to generic', () => {
    expect(classifyTestReplyError(new Error('network down'))).toBe('generic');
    expect(classifyTestReplyError({ response: { status: 500 } })).toBe('generic');
    expect(classifyTestReplyError(undefined)).toBe('generic');
    expect(classifyTestReplyError(null)).toBe('generic');
  });
});
