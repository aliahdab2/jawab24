import { describe, it, expect } from 'vitest';
import { BusinessProfileSchema } from '../utils/validation';

/**
 * `channels.whatsapp` is dual-shape: legacy rows hold a single string, the
 * /business editor writes an array (any listed number can be on WhatsApp
 * independently). The union must keep accepting BOTH — narrowing it to the
 * array shape would 400 every save from a page that still carries the legacy
 * string, because the editor PUTs the whole merchant half back on each save.
 */
describe('BusinessProfileSchema — channels.whatsapp dual shape', () => {
  it('accepts the legacy single string', () => {
    const parsed = BusinessProfileSchema.safeParse({
      channels: { whatsapp: '+963937549674' },
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts an array of numbers', () => {
    const parsed = BusinessProfileSchema.safeParse({
      channels: { whatsapp: ['+963937549674', '0911223344'] },
    });
    expect(parsed.success).toBe(true);
  });

  it('bounds array entries like `phones` (3–40 chars, max 10)', () => {
    expect(BusinessProfileSchema.safeParse({
      channels: { whatsapp: ['12'] },
    }).success).toBe(false);
    expect(BusinessProfileSchema.safeParse({
      channels: { whatsapp: Array.from({ length: 11 }, (_, i) => `091122334${i}`) },
    }).success).toBe(false);
  });
});
