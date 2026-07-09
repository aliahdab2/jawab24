import { describe, it, expect } from 'vitest';
import type { Page } from '@jawab24/shared';
import { hasMultipleConnectedChannels } from './channels';

const page = (over: Partial<Page> = {}): Page => ({ id: 'p', ...over }) as unknown as Page;

describe('hasMultipleConnectedChannels', () => {
  it('is false for a single Facebook-only page', () => {
    expect(hasMultipleConnectedChannels([page({ facebookPageId: 'fb' })])).toBe(false);
  });

  it('is true when one page has both Facebook and Instagram', () => {
    expect(hasMultipleConnectedChannels([page({ facebookPageId: 'fb', instagramAccountId: 'ig' })])).toBe(true);
  });

  it('is true across pages: one Facebook, one WhatsApp', () => {
    expect(hasMultipleConnectedChannels([page({ facebookPageId: 'fb' }), page({ whatsappConnected: true })])).toBe(true);
  });

  it('is false for two Facebook pages (still a single channel)', () => {
    expect(hasMultipleConnectedChannels([page({ facebookPageId: 'a' }), page({ facebookPageId: 'b' })])).toBe(false);
  });

  it('counts Instagram connected via username too', () => {
    expect(hasMultipleConnectedChannels([page({ facebookPageId: 'fb', instagramUsername: 'shop' })])).toBe(true);
  });

  it('is false for no pages', () => {
    expect(hasMultipleConnectedChannels([])).toBe(false);
  });
});
