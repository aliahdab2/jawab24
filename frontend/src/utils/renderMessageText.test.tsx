import { describe, it, expect } from 'vitest';
import { renderMessageText } from './renderMessageText';

describe('renderMessageText', () => {
  it('returns plain string when no phone number', () => {
    expect(renderMessageText('مرحبا كيف الحال')).toBe('مرحبا كيف الحال');
  });

  it('wraps a phone number with dir="ltr" span', () => {
    const result = renderMessageText('تواصل معنا +966501234567 شكرا');
    expect(Array.isArray(result)).toBe(true);
    const parts = result as React.ReactElement[];
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe('تواصل معنا ');
    expect(parts[1].props.dir).toBe('ltr');
    expect(parts[1].props.children).toBe('+966501234567');
    expect(parts[2]).toBe(' شكرا');
  });

  it('handles phone number at start of text', () => {
    const result = renderMessageText('+46700224720 هو رقمنا');
    expect(Array.isArray(result)).toBe(true);
  });

  it('handles phone with dashes and spaces', () => {
    const result = renderMessageText('اتصل على +966-50-123-4567');
    expect(Array.isArray(result)).toBe(true);
    const parts = result as React.ReactElement[];
    const phonePart = parts.find((p: unknown) => typeof p === 'object' && p !== null && 'props' in (p as React.ReactElement));
    expect((phonePart as React.ReactElement).props.dir).toBe('ltr');
  });

  it('handles multiple phone numbers', () => {
    const result = renderMessageText('+966501234567 أو +46700224720');
    expect(Array.isArray(result)).toBe(true);
    const spans = (result as React.ReactElement[]).filter((p: unknown) => typeof p === 'object' && p !== null && 'props' in (p as React.ReactElement));
    expect(spans).toHaveLength(2);
  });
});
