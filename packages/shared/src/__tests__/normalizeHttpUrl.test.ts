import { describe, it, expect } from 'vitest';
import { normalizeHttpUrl } from '../utils/validation';

describe('normalizeHttpUrl', () => {
  it('passes through already-valid http(s) URLs unchanged', () => {
    expect(normalizeHttpUrl('https://mystore.com/offer')).toBe('https://mystore.com/offer');
    expect(normalizeHttpUrl('http://mystore.com')).toBe('http://mystore.com');
    expect(normalizeHttpUrl('  https://mystore.com/offer  ')).toBe('https://mystore.com/offer');
  });

  it('auto-prepends https:// for bare domains merchants actually paste', () => {
    expect(normalizeHttpUrl('mystore.com/offer')).toBe('https://mystore.com/offer');
    expect(normalizeHttpUrl('www.mystore.com')).toBe('https://www.mystore.com/');
    expect(normalizeHttpUrl('shop.example.co/products?id=7')).toBe('https://shop.example.co/products?id=7');
  });

  it('rejects explicit non-http schemes instead of mangling them', () => {
    expect(normalizeHttpUrl('tel:+963944123456')).toBeNull();
    expect(normalizeHttpUrl('whatsapp://send?phone=1')).toBeNull();
    expect(normalizeHttpUrl('ftp://files.example.com')).toBeNull();
  });

  it('rejects free text and dotless input (nothing to rescue)', () => {
    expect(normalizeHttpUrl('not a url')).toBeNull();
    expect(normalizeHttpUrl('صفحتنا')).toBeNull();
    expect(normalizeHttpUrl('localhost')).toBeNull();
    expect(normalizeHttpUrl('')).toBeNull();
    expect(normalizeHttpUrl('   ')).toBeNull();
  });
});
