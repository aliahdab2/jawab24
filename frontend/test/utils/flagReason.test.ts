import { describe, it, expect, vi } from 'vitest';
import {
  getPrimaryFlag,
  getFlagTagStyle,
  translateFlagReason,
} from '../../src/utils/flagReason';

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

  it('returns warning style for non-urgent flags', () => {
    expect(getFlagTagStyle('low_confidence')).toEqual({ cssClass: 'status-warning', urgent: false });
    expect(getFlagTagStyle('info_not_in_kb')).toEqual({ cssClass: 'status-warning', urgent: false });
  });
});

describe('translateFlagReason', () => {
  const mockT = vi.fn((key: string, params?: Record<string, string>) => {
    const translations: Record<string, string> = {
      'cancellation_request': 'Cancellation request',
      'low_confidence': 'Low confidence reply',
      'slaNoReply': `No reply after ${params?.minutes || '?'} min`,
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
      .toBe('Cancellation request, Low confidence reply');
  });

  it('uses Arabic separator for ar locale', () => {
    expect(translateFlagReason('cancellation_request,low_confidence', mockT, 'ar'))
      .toBe('Cancellation request، Low confidence reply');
  });

  it('falls back to raw key for unknown flags', () => {
    expect(translateFlagReason('some_unknown_flag', mockT, 'en')).toBe('some_unknown_flag');
  });

  it('handles structured SLA format', () => {
    expect(translateFlagReason('sla_no_reply:60', mockT, 'en')).toBe('No reply after 60 min');
  });

  it('handles legacy SLA format', () => {
    expect(translateFlagReason('SLA: no reply after 45 min', mockT, 'en')).toBe('No reply after 45 min');
  });
});
