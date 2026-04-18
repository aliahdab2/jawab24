import { describe, it, expect } from 'vitest';
import { buildWebUrl } from './webUrl';

describe('buildWebUrl', () => {
  it('produces Arabic URLs with no locale prefix', () => {
    expect(buildWebUrl('/pricing', 'ar')).toBe('https://jawab24.com/pricing');
  });

  it('produces English URLs with /en prefix', () => {
    expect(buildWebUrl('/pricing', 'en')).toBe('https://jawab24.com/en/pricing');
  });

  it('treats undefined locale as Arabic (the default)', () => {
    expect(buildWebUrl('/pricing', undefined)).toBe('https://jawab24.com/pricing');
  });

  it('normalizes a path missing its leading slash', () => {
    expect(buildWebUrl('pricing', 'en')).toBe('https://jawab24.com/en/pricing');
  });

  it('preserves query strings and redirects', () => {
    expect(
      buildWebUrl('/login?redirect=%2Fcheckout%3FplanId%3D1', 'en'),
    ).toBe('https://jawab24.com/en/login?redirect=%2Fcheckout%3FplanId%3D1');
  });
});
