import { describe, it, expect } from 'vitest';
import { formatBusinessInfoPrompt, hasRoutableContactChannel } from '../businessInfoPrompt';
import type { BusinessProfile } from '../index';
import type { MerchantProvenanceMap } from '../businessProfileMerge';

/**
 * The coupling test whose absence let a divergence ship.
 *
 * `hasRoutableContactChannel` answers ONE question — "will BUSINESS_INFO publish
 * something a customer can reach this business through?" — because the INFO-DESK
 * block (D-085) routes to exactly that, and otherwise tells the model to say it
 * has no channel and stop. The settings card promises merchants that the warning
 * and the block agree (D-087).
 *
 * They did not. The predicate shipped checking phones and WhatsApp while the
 * block also publishes Email, so an email-only page was told it had no channel
 * while the model would happily have routed to it. A per-field boolean table
 * would not have caught that — only asking BOTH sides the same question does.
 * Teach `formatBusinessInfoPrompt` a fourth routable line without teaching the
 * predicate and this fails.
 */
describe('hasRoutableContactChannel agrees with the block it gates', () => {
  /** The lines a customer can actually reach the business through. */
  const CONTACT_LINE = /^- (Phones|WhatsApp|Email) \//;
  const ABSENCE_MARKER = '[NOT_PROVIDED]';

  const publishesAContactLine = (p: BusinessProfile, prov?: MerchantProvenanceMap) => {
    const block = formatBusinessInfoPrompt(p, prov);
    if (!block) return false;
    return block
      .split('\n')
      .some((line) => CONTACT_LINE.test(line) && !line.includes(ABSENCE_MARKER));
  };

  const CONFIRMED = { source: 'editor' as const, confirmedAt: '2026-08-01T00:00:00Z' };
  // Unconfirmed by definition — that is what makes fb_sync a fallback, not an
  // override (the gate `isFieldAuthoritative` applies).
  const FB = { source: 'fb_sync' as const, confirmedAt: null };

  const CASES: Array<[string, BusinessProfile, MerchantProvenanceMap | undefined]> = [
    ['phone only', { phones: [{ number: '0111222333' }] }, undefined],
    ['legacy singular phone', { phone: '0111222333' }, undefined],
    ['whatsapp only', { channels: { whatsapp: ['0999888777'] } }, undefined],
    ['email only', { email: 'hi@shop.com' }, undefined],
    ['phone, confirmed edit', { phones: [{ number: '0111222333' }] }, { phones: CONFIRMED }],
    ['phone, unconfirmed fb_sync', { phones: [{ number: '0111222333' }] }, { phones: FB }],
    ['whatsapp, unconfirmed fb_sync', { channels: { whatsapp: ['0999888777'] } }, { channels: FB }],
    ['email, unconfirmed fb_sync', { email: 'hi@shop.com' }, { email: FB }],
    ['address only — a customer cannot phone an address', { address: 'Baghdad St', city: 'Damascus' }, undefined],
    ['empty profile', {}, undefined],
    ['phone AND email, both demoted', { phones: [{ number: '011' }], email: 'a@b.c' }, { phones: FB, email: FB }],
    ['phone demoted, email authoritative', { phones: [{ number: '011' }], email: 'a@b.c' }, { phones: FB }],
  ];

  it.each(CASES)('%s', (_name, profile, provenance) => {
    expect(hasRoutableContactChannel(profile, provenance)).toBe(publishesAContactLine(profile, provenance));
  });

  /**
   * `business_profile` is schemaless jsonb with four writers, and since D-087
   * this predicate runs inside `serializeListPage` — a throw there 500s
   * `GET /pages` for a whole workspace, not just one page's warning.
   */
  it('is total over the shapes the column can actually hold', () => {
    const junk: unknown[] = [
      { phones: '0911000210' }, { phones: 42 }, { phones: { number: '09' } },
      { phone: 42 }, { channels: 'whatsapp' }, { email: 42 },
      null, undefined, 'text', 42, [],
    ];
    for (const shape of junk) {
      expect(() => hasRoutableContactChannel(shape as BusinessProfile)).not.toThrow();
      expect(hasRoutableContactChannel(shape as BusinessProfile)).toBe(false);
    }
  });
});
