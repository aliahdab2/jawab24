import { describe, it, expect } from 'vitest';
import { buildWhatsAppUrl, extractWhatsAppNumber } from '@/lib/whatsapp';

describe('buildWhatsAppUrl', () => {
  it('strips non-digits and builds a wa.me link with a prefilled message', () => {
    expect(buildWhatsAppUrl('+46 700 224 720', 'hello there')).toBe(
      'https://wa.me/46700224720?text=hello%20there',
    );
  });

  it('omits ?text= when no message is given (Post Reply button is number-only)', () => {
    expect(buildWhatsAppUrl('+963944123456')).toBe('https://wa.me/963944123456');
    expect(buildWhatsAppUrl('963944123456', '')).toBe('https://wa.me/963944123456');
  });

  it('returns empty string when the input has no digits', () => {
    expect(buildWhatsAppUrl('abc')).toBe('');
    expect(buildWhatsAppUrl('')).toBe('');
  });
});

describe('extractWhatsAppNumber', () => {
  it('round-trips a number built by buildWhatsAppUrl', () => {
    expect(extractWhatsAppNumber(buildWhatsAppUrl('+963 944 123 456'))).toBe('963944123456');
  });

  it('extracts digits from a wa.me link with a query string', () => {
    expect(extractWhatsAppNumber('https://wa.me/46700224720?text=hi')).toBe('46700224720');
  });

  it('returns null for non-wa.me URLs and malformed input', () => {
    expect(extractWhatsAppNumber('https://example.com/46700224720')).toBeNull();
    expect(extractWhatsAppNumber('https://wa.me/notdigits')).toBeNull();
    // Leading zero is not a valid international number.
    expect(extractWhatsAppNumber('https://wa.me/0944123456')).toBeNull();
    expect(extractWhatsAppNumber('http://wa.me/46700224720')).toBeNull();
    expect(extractWhatsAppNumber('not a url')).toBeNull();
  });
});
