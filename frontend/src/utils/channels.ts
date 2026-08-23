import type { Page } from '@jawab24/shared';

/**
 * True when a workspace actively replies on more than one channel — i.e. 2+ of
 * Facebook / Instagram / WhatsApp have auto-reply ENABLED across its pages.
 *
 * This gates the per-conversation channel icon on inbox rows. Connection alone
 * isn't enough: a Facebook page almost always carries a linked Instagram business
 * account, so a merchant who only runs Facebook would otherwise be counted as
 * multi-channel and get an icon on every row. A channel that's linked but paused
 * (auto-reply off) doesn't count — if only one channel is live, the channel is
 * unambiguous and the icon is just noise.
 */
export function hasMultipleActiveChannels(pages: Page[]): boolean {
  const channels = new Set<string>();
  for (const p of pages) {
    if (p.facebookPageId && p.autoReplyEnabled) channels.add('facebook');
    if ((p.instagramAccountId || p.instagramUsername) && p.instagramAutoReplyEnabled) channels.add('instagram');
    if (p.whatsappConnected && p.whatsappAutoReplyEnabled) channels.add('whatsapp');
  }
  return channels.size > 1;
}
