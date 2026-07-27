import { describe, it, expect } from 'vitest';
import { postsScanBlockerForPage } from './page';

// The rule itself is tested in packages/shared (catalogScanEligibility.test.ts).
// What matters here is the client's mapping onto it: which Page field stands in
// for "we hold a usable token".
describe('postsScanBlockerForPage', () => {
  it('offers the scan on a connected Facebook page', () => {
    expect(postsScanBlockerForPage({ facebookPageId: '123', isConnected: true })).toBeNull();
  });

  it('reads isConnected:false as no usable token', () => {
    expect(postsScanBlockerForPage({ facebookPageId: '123', isConnected: false })).toBe('disconnected');
  });

  it('blocks a WhatsApp-only page regardless of its connection state', () => {
    expect(postsScanBlockerForPage({ facebookPageId: null, isConnected: true })).toBe('noFacebook');
  });

  it('treats an absent isConnected as connected, matching the app-wide convention', () => {
    expect(postsScanBlockerForPage({ facebookPageId: '123' })).toBeNull();
  });
});
