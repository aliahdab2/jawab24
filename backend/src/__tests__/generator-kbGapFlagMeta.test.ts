/**
 * Unit coverage for buildKbGapFlagMeta — the helper that captures the customer
 * question behind a KB-gap flag (info/price/phone) into flag_meta, so the inbox
 * can show the merchant exactly what to add to Business Info.
 */
import { describe, it, expect } from 'vitest';
import { buildKbGapFlagMeta, KB_GAP_QUESTION_MAX } from '../services/reply/generator';

describe('buildKbGapFlagMeta', () => {
  it('captures the question when info_not_in_kb is flagged', () => {
    expect(buildKbGapFlagMeta(['info_not_in_kb'], 'هل عندكم توصيل لجدة؟')).toEqual({
      info_not_in_kb: { question: 'هل عندكم توصيل لجدة؟' },
    });
  });

  it('captures the question for a price gap too', () => {
    expect(buildKbGapFlagMeta(['price_not_in_kb'], 'كم سعر دورة ICDL؟')).toEqual({
      price_not_in_kb: { question: 'كم سعر دورة ICDL؟' },
    });
  });

  it('captures the question for a phone gap', () => {
    expect(buildKbGapFlagMeta(['phone_not_in_kb'], 'ما رقم تواصلكم؟')).toEqual({
      phone_not_in_kb: { question: 'ما رقم تواصلكم؟' },
    });
  });

  it('captures even when the KB-gap flag is one of several flags', () => {
    expect(buildKbGapFlagMeta(['low_confidence', 'info_not_in_kb'], 'Do you ship to Jeddah?')).toEqual({
      info_not_in_kb: { question: 'Do you ship to Jeddah?' },
    });
  });

  it('stores the question under each KB-gap flag present', () => {
    expect(buildKbGapFlagMeta(['info_not_in_kb', 'price_not_in_kb'], 'What courses and how much?')).toEqual({
      info_not_in_kb: { question: 'What courses and how much?' },
      price_not_in_kb: { question: 'What courses and how much?' },
    });
  });

  it('returns null when no KB-gap flag is present', () => {
    expect(buildKbGapFlagMeta(['low_confidence'], 'anything')).toBeNull();
    expect(buildKbGapFlagMeta(['angry_customer'], 'anything')).toBeNull();
    expect(buildKbGapFlagMeta([], 'anything')).toBeNull();
  });

  it('returns null when there is no usable question text', () => {
    expect(buildKbGapFlagMeta(['info_not_in_kb'], undefined)).toBeNull();
    expect(buildKbGapFlagMeta(['price_not_in_kb'], '   ')).toBeNull();
  });

  it('trims surrounding whitespace', () => {
    expect(buildKbGapFlagMeta(['info_not_in_kb'], '  متى تفتحون؟  ')).toEqual({
      info_not_in_kb: { question: 'متى تفتحون؟' },
    });
  });

  it('clips an overly long question to the storage cap with an ellipsis', () => {
    const long = 'q'.repeat(KB_GAP_QUESTION_MAX + 50);
    const result = buildKbGapFlagMeta(['info_not_in_kb'], long);
    const question = result?.info_not_in_kb?.question ?? '';
    expect(question.length).toBe(KB_GAP_QUESTION_MAX);
    expect(question.endsWith('…')).toBe(true);
  });
});
