import { describe, it, expect } from 'vitest';
import { resolveEffectiveReplyMode, REPLY_MODES } from '../index';

describe('resolveEffectiveReplyMode (page override ?? workspace default ?? sales)', () => {
  it('returns the page override when set', () => {
    expect(resolveEffectiveReplyMode('info', 'sales')).toBe('info');
    expect(resolveEffectiveReplyMode('sales', 'info')).toBe('sales'); // explicit pin survives a workspace flip
  });

  it('falls back to the workspace default when the page override is null/undefined (inherit)', () => {
    expect(resolveEffectiveReplyMode(null, 'info')).toBe('info');
    expect(resolveEffectiveReplyMode(undefined, 'info')).toBe('info');
    expect(resolveEffectiveReplyMode(null, 'sales')).toBe('sales');
  });

  it('defaults to sales when neither layer has a value', () => {
    expect(resolveEffectiveReplyMode(null, undefined)).toBe('sales');
    expect(resolveEffectiveReplyMode(undefined, undefined)).toBe('sales');
  });

  it('treats an unknown stored string as unset at BOTH layers (defensive: raw varchar)', () => {
    expect(resolveEffectiveReplyMode('garbage', 'info')).toBe('info');
    expect(resolveEffectiveReplyMode('garbage', 'nonsense')).toBe('sales');
    expect(resolveEffectiveReplyMode('', 'info')).toBe('info');
  });

  it('REPLY_MODES enumerates exactly the two modes (schema/Zod mirror)', () => {
    expect(REPLY_MODES).toEqual(['sales', 'info']);
  });
});
