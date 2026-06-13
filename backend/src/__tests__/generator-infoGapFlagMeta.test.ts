/**
 * Unit coverage for buildInfoGapFlagMeta — the helper that captures the
 * customer question behind an `info_not_in_kb` flag into flag_meta, so the
 * inbox can show the merchant exactly what to add to Business Info.
 */
import { describe, it, expect } from 'vitest';
import { buildInfoGapFlagMeta, INFO_GAP_QUESTION_MAX } from '../services/reply/generator';

describe('buildInfoGapFlagMeta', () => {
  it('captures the question when info_not_in_kb is flagged', () => {
    expect(buildInfoGapFlagMeta(['info_not_in_kb'], 'هل عندكم توصيل لجدة؟')).toEqual({
      info_not_in_kb: { question: 'هل عندكم توصيل لجدة؟' },
    });
  });

  it('captures even when info_not_in_kb is one of several flags', () => {
    expect(buildInfoGapFlagMeta(['low_confidence', 'info_not_in_kb'], 'Do you ship to Jeddah?')).toEqual({
      info_not_in_kb: { question: 'Do you ship to Jeddah?' },
    });
  });

  it('returns null when the flag is absent', () => {
    expect(buildInfoGapFlagMeta(['low_confidence'], 'anything')).toBeNull();
    expect(buildInfoGapFlagMeta([], 'anything')).toBeNull();
  });

  it('returns null when there is no usable question text', () => {
    expect(buildInfoGapFlagMeta(['info_not_in_kb'], undefined)).toBeNull();
    expect(buildInfoGapFlagMeta(['info_not_in_kb'], '   ')).toBeNull();
  });

  it('trims surrounding whitespace', () => {
    expect(buildInfoGapFlagMeta(['info_not_in_kb'], '  متى تفتحون؟  ')).toEqual({
      info_not_in_kb: { question: 'متى تفتحون؟' },
    });
  });

  it('clips an overly long question to the storage cap with an ellipsis', () => {
    const long = 'q'.repeat(INFO_GAP_QUESTION_MAX + 50);
    const result = buildInfoGapFlagMeta(['info_not_in_kb'], long);
    const question = result?.info_not_in_kb?.question ?? '';
    expect(question.length).toBe(INFO_GAP_QUESTION_MAX);
    expect(question.endsWith('…')).toBe(true);
  });
});
