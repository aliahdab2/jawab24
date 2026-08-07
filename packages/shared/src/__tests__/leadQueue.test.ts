import { describe, it, expect } from 'vitest';
import {
  parseLeadSortOrder,
  shouldAdvanceOnContact,
  LEAD_SORT_ORDERS,
  DEFAULT_LEAD_SORT_ORDER,
  type LeadStatus,
} from '../index';

describe('parseLeadSortOrder', () => {
  it('accepts both supported orders', () => {
    expect(parseLeadSortOrder('newest')).toBe('newest');
    expect(parseLeadSortOrder('oldest')).toBe('oldest');
  });

  it('defaults to newest-first — the order the list has always used', () => {
    expect(DEFAULT_LEAD_SORT_ORDER).toBe('newest');
    expect(parseLeadSortOrder(undefined)).toBe('newest');
  });

  // The value arrives from an HTTP query param and from localStorage, both of
  // which a user can set to anything. An unrecognised order must fall back, not
  // reach the query builder or 400 the whole list.
  it.each([
    ['unknown string', 'sideways'],
    ['SQL-ish payload', "created_at; DROP TABLE leads"],
    ['empty string', ''],
    ['null', null],
    ['number', 3],
    ['object', { sort: 'oldest' }],
    ['array', ['oldest']],
  ])('falls back to the default for %s', (_label, value) => {
    expect(parseLeadSortOrder(value)).toBe(DEFAULT_LEAD_SORT_ORDER);
  });

  it('is case-sensitive — no silent normalisation of near-misses', () => {
    expect(parseLeadSortOrder('Oldest')).toBe(DEFAULT_LEAD_SORT_ORDER);
    expect(parseLeadSortOrder(' oldest')).toBe(DEFAULT_LEAD_SORT_ORDER);
  });

  it('every declared order parses back to itself (no unreachable member)', () => {
    for (const order of LEAD_SORT_ORDERS) {
      expect(parseLeadSortOrder(order)).toBe(order);
    }
  });
});

describe('shouldAdvanceOnContact', () => {
  it('advances a new lead — tapping call/WhatsApp IS the contact', () => {
    expect(shouldAdvanceOnContact('new')).toBe(true);
  });

  // The pipeline only moves forward. Re-contacting a converted customer must
  // never drag them back to "contacted", which would corrupt the merchant's
  // funnel and (via updateLeadStatus) clear their returning flag.
  it.each<LeadStatus>(['contacted', 'converted'])('leaves an already-worked lead (%s) alone', (status) => {
    expect(shouldAdvanceOnContact(status)).toBe(false);
  });
});
