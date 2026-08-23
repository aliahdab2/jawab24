import { describe, it, expect } from 'vitest';
import type { Page } from '@jawab24/shared';
import { hasMultipleActiveChannels } from './channels';

const page = (over: Partial<Page> = {}): Page => ({ id: 'p', ...over }) as unknown as Page;

describe('hasMultipleActiveChannels', () => {
  it('is false for a single Facebook page with auto-reply on', () => {
    expect(hasMultipleActiveChannels([page({ facebookPageId: 'fb', autoReplyEnabled: true })])).toBe(false);
  });

  it('is true when Facebook and Instagram both have auto-reply on', () => {
    expect(hasMultipleActiveChannels([
      page({ facebookPageId: 'fb', autoReplyEnabled: true, instagramAccountId: 'ig', instagramAutoReplyEnabled: true }),
    ])).toBe(true);
  });

  it('is FALSE when Facebook is on but a linked Instagram is paused (off)', () => {
    // The common case: an IG business account is linked to the FB page but the
    // merchant only runs Facebook — the channel icon must stay hidden.
    expect(hasMultipleActiveChannels([
      page({ facebookPageId: 'fb', autoReplyEnabled: true, instagramAccountId: 'ig', instagramAutoReplyEnabled: false }),
    ])).toBe(false);
  });

  it('is true across pages: one Facebook on, one WhatsApp on', () => {
    expect(hasMultipleActiveChannels([
      page({ facebookPageId: 'fb', autoReplyEnabled: true }),
      page({ whatsappConnected: true, whatsappAutoReplyEnabled: true }),
    ])).toBe(true);
  });

  it('is false for two Facebook pages (still a single channel)', () => {
    expect(hasMultipleActiveChannels([
      page({ facebookPageId: 'a', autoReplyEnabled: true }),
      page({ facebookPageId: 'b', autoReplyEnabled: true }),
    ])).toBe(false);
  });

  it('is false when everything is connected but paused', () => {
    expect(hasMultipleActiveChannels([
      page({ facebookPageId: 'fb', autoReplyEnabled: false, instagramAccountId: 'ig', instagramAutoReplyEnabled: false }),
    ])).toBe(false);
  });

  it('is false for no pages', () => {
    expect(hasMultipleActiveChannels([])).toBe(false);
  });
});
