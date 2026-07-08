import { describe, it, expect } from 'vitest';
import { intentLabelKey } from './feedPreview';

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
