import { describe, it, expect } from 'vitest';
import { isLowSignalText, intentLabelKey } from './feedPreview';

describe('isLowSignalText', () => {
  it('treats empty / whitespace as low-signal', () => {
    expect(isLowSignalText(null)).toBe(true);
    expect(isLowSignalText(undefined)).toBe(true);
    expect(isLowSignalText('')).toBe(true);
    expect(isLowSignalText('   ')).toBe(true);
  });

  it('treats punctuation / emoji-only as low-signal', () => {
    expect(isLowSignalText('...')).toBe(true);
    expect(isLowSignalText('!!!')).toBe(true);
    expect(isLowSignalText('👍')).toBe(true);
    expect(isLowSignalText('. . .')).toBe(true);
  });

  it('treats a real word in any script as meaningful', () => {
    expect(isLowSignalText('hi')).toBe(false);
    expect(isLowSignalText('عنوان')).toBe(false); // a genuine Arabic word is NOT low-signal
    expect(isLowSignalText('Price?')).toBe(false);
    expect(isLowSignalText('100')).toBe(false); // numbers count as meaningful
  });
});

describe('intentLabelKey', () => {
  it('maps canonical intents to their common-namespace key', () => {
    expect(intentLabelKey('QUESTION')).toBe('intentLabel.QUESTION');
    expect(intentLabelKey('purchase_intent')).toBe('intentLabel.PURCHASE_INTENT'); // case-insensitive
    expect(intentLabelKey(' COMPLAINT ')).toBe('intentLabel.COMPLAINT'); // trimmed
  });

  it('returns null for empty or unknown intents', () => {
    expect(intentLabelKey(null)).toBeNull();
    expect(intentLabelKey(undefined)).toBeNull();
    expect(intentLabelKey('')).toBeNull();
    expect(intentLabelKey('SOMETHING_GPT_INVENTED')).toBeNull();
  });
});
