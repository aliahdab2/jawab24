import { describe, it, expect, vi } from 'vitest';
import {
  getPrimaryFlag,
  getFlagTagStyle,
  translateFlagReason,
  isKbRelatedFlag,
} from '../../src/utils/flagReason';

describe('isKbRelatedFlag', () => {
  it('returns false for null/undefined/empty', () => {
    expect(isKbRelatedFlag(null)).toBe(false);
    expect(isKbRelatedFlag(undefined)).toBe(false);
    expect(isKbRelatedFlag('')).toBe(false);
  });

  it('returns true for info_not_in_kb', () => {
    expect(isKbRelatedFlag('info_not_in_kb')).toBe(true);
  });

  it('returns true for price_not_in_kb', () => {
    expect(isKbRelatedFlag('price_not_in_kb')).toBe(true);
  });

  it('returns false for unrelated flags', () => {
    expect(isKbRelatedFlag('low_confidence')).toBe(false);
    expect(isKbRelatedFlag('cancellation_request')).toBe(false);
    expect(isKbRelatedFlag('angry_customer')).toBe(false);
  });

  it('returns true when KB flag is the primary (first non-urgent) flag', () => {
    expect(isKbRelatedFlag('info_not_in_kb,low_confidence')).toBe(true);
  });

  it('returns false when an urgent flag takes priority over a KB flag', () => {
    // cancellation_request is urgent — it becomes the primary flag, not info_not_in_kb
    expect(isKbRelatedFlag('info_not_in_kb,cancellation_request')).toBe(false);
    expect(isKbRelatedFlag('low_confidence,price_not_in_kb,angry_customer')).toBe(false);
  });
});

describe('getPrimaryFlag', () => {
  it('returns null for null/undefined/empty', () => {
    expect(getPrimaryFlag(null)).toBeNull();
    expect(getPrimaryFlag(undefined)).toBeNull();
    expect(getPrimaryFlag('')).toBeNull();
  });

  it('returns the single flag', () => {
    expect(getPrimaryFlag('low_confidence')).toBe('low_confidence');
  });

  it('prefers urgent flag over non-urgent', () => {
    expect(getPrimaryFlag('low_confidence,cancellation_request')).toBe('cancellation_request');
    expect(getPrimaryFlag('info_not_in_kb,refund_request,low_confidence')).toBe('refund_request');
  });

  it('returns first urgent flag when multiple urgent flags exist', () => {
    expect(getPrimaryFlag('cancellation_request,angry_customer')).toBe('cancellation_request');
  });

  it('returns first flag when no urgent flags exist', () => {
    expect(getPrimaryFlag('low_confidence,info_not_in_kb')).toBe('low_confidence');
  });

  it('trims whitespace', () => {
    expect(getPrimaryFlag(' cancellation_request , low_confidence ')).toBe('cancellation_request');
  });
});

describe('getFlagTagStyle', () => {
  it('returns error style for urgent flags', () => {
    expect(getFlagTagStyle('cancellation_request')).toEqual({ cssClass: 'status-error', urgent: true });
    expect(getFlagTagStyle('refund_request')).toEqual({ cssClass: 'status-error', urgent: true });
    expect(getFlagTagStyle('exchange_request')).toEqual({ cssClass: 'status-error', urgent: true });
    expect(getFlagTagStyle('angry_customer')).toEqual({ cssClass: 'status-error', urgent: true });
  });

  it('returns warning (amber) style for all non-urgent flags (incl. missing-from-KB prompts)', () => {
    expect(getFlagTagStyle('low_confidence')).toEqual({ cssClass: 'status-warning', urgent: false });
    expect(getFlagTagStyle('info_not_in_kb')).toEqual({ cssClass: 'status-warning', urgent: false });
    expect(getFlagTagStyle('price_not_in_kb')).toEqual({ cssClass: 'status-warning', urgent: false });
    expect(getFlagTagStyle('phone_not_in_kb')).toEqual({ cssClass: 'status-warning', urgent: false });
  });
});

describe('translateFlagReason', () => {
  const mockT = vi.fn((key: string, params?: Record<string, string>) => {
    const translations: Record<string, string> = {
      'cancellation_request': 'Cancellation request',
      'low_confidence': 'Needs your review',
      'sla_no_reply': `No reply after ${params?.minutes || '?'} min`,
      'dm_failed': 'DM failed',
      'dm_failed_unknown': 'DM failed',
      'dm_failed_window_expired': 'DM failed — 24-hour window expired',
    };
    return translations[key] || key;
  });

  it('returns empty string for null/undefined', () => {
    expect(translateFlagReason(null, mockT, 'en')).toBe('');
    expect(translateFlagReason(undefined, mockT, 'en')).toBe('');
  });

  it('translates a single flag', () => {
    expect(translateFlagReason('cancellation_request', mockT, 'en')).toBe('Cancellation request');
  });

  it('translates comma-separated flags', () => {
    expect(translateFlagReason('cancellation_request,low_confidence', mockT, 'en'))
      .toBe('Cancellation request, Needs your review');
  });

  it('uses Arabic separator for ar locale', () => {
    expect(translateFlagReason('cancellation_request,low_confidence', mockT, 'ar'))
      .toBe('Cancellation request، Needs your review');
  });

  it('falls back to raw key for unknown flags', () => {
    expect(translateFlagReason('some_unknown_flag', mockT, 'en')).toBe('some_unknown_flag');
  });

  it('uses flagMeta.sla_no_reply.minutes for SLA interpolation', () => {
    expect(translateFlagReason('sla_no_reply', mockT, 'en', { sla_no_reply: { minutes: 60 } }))
      .toBe('No reply after 60 min');
  });

  it('uses flagMeta.dm_failed.bucket for per-bucket DM failure label', () => {
    expect(translateFlagReason('dm_failed', mockT, 'en', { dm_failed: { bucket: 'window_expired' } }))
      .toBe('DM failed — 24-hour window expired');
  });

  it('falls back to generic dm_failed label when bucket has no translation', () => {
    expect(translateFlagReason('dm_failed', mockT, 'en', { dm_failed: { bucket: 'exotic_new_bucket' } }))
      .toBe('DM failed');
  });

  it('recognizes legacy sla_no_reply:NN encoding (pre-flag_meta rows)', () => {
    expect(translateFlagReason('sla_no_reply:60', mockT, 'en')).toBe('No reply after 60 min');
  });

  it('recognizes legacy "SLA: no reply after NN min" encoding', () => {
    expect(translateFlagReason('SLA: no reply after 45 min', mockT, 'en')).toBe('No reply after 45 min');
  });

  it('recognizes legacy "DM failed: bucket" encoding (pre-flag_meta rows)', () => {
    expect(translateFlagReason('DM failed: window_expired', mockT, 'en'))
      .toBe('DM failed — 24-hour window expired');
  });
});
