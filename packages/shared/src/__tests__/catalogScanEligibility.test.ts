import { describe, it, expect } from 'vitest';
import { postsScanEligibility } from '../catalogScanEligibility';

describe('postsScanEligibility', () => {
  it('passes a Facebook page with a usable token, carrying the id for the Graph call', () => {
    const result = postsScanEligibility({ facebookPageId: '123', hasUsableToken: true });
    expect(result).toEqual({ eligible: true, facebookPageId: '123' });
  });

  it('blocks a WhatsApp-only page — it has no Facebook posts to read', () => {
    expect(postsScanEligibility({ facebookPageId: null, hasUsableToken: true }))
      .toEqual({ eligible: false, blocker: 'noFacebook' });
  });

  it('blocks a Facebook page with no usable token', () => {
    expect(postsScanEligibility({ facebookPageId: '123', hasUsableToken: false }))
      .toEqual({ eligible: false, blocker: 'disconnected' });
  });

  it('reports the missing identity first — reconnecting Facebook is not the fix for a WhatsApp page', () => {
    expect(postsScanEligibility({ facebookPageId: null, hasUsableToken: false }))
      .toEqual({ eligible: false, blocker: 'noFacebook' });
  });

  it('treats an undefined page id as no Facebook identity', () => {
    expect(postsScanEligibility({ facebookPageId: undefined, hasUsableToken: true }))
      .toEqual({ eligible: false, blocker: 'noFacebook' });
  });
});
