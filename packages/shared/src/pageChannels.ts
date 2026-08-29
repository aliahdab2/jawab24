/**
 * Which reply channels a page card carries, and whether each one is replying.
 *
 * A `pages` row is ONE card holding up to three channels — Facebook (the row's
 * historical identity), Instagram (linked to the Facebook page, or connected
 * directly) and WhatsApp — each with its own auto-reply toggle. Anything that
 * answers "is this page replying?" must ask the CONNECTED channels, never the
 * Facebook column alone: `auto_reply_enabled` is false by definition on a
 * WhatsApp-only card (there is no Facebook page to switch on), so reading it as
 * the page's state reported a merchant whose WhatsApp was answering every
 * message as "Auto-reply off" in the support console (2026-08-29) — the same
 * trap the `disconnected` predicate had already been cured of.
 *
 * One predicate, three readers — the merchant dashboard's channel badges, the
 * support console's page card, and its health flags — so they cannot drift.
 */
export type ChannelPlatform = 'facebook' | 'instagram' | 'whatsapp';

export interface PageChannelInput {
    facebookPageId?: string | null;
    autoReplyEnabled?: boolean | null;
    instagramAccountId?: string | null;
    instagramUsername?: string | null;
    instagramAutoReplyEnabled?: boolean | null;
    /** A WhatsApp business token is stored (Embedded Signup completed). */
    whatsappConnected?: boolean | null;
    whatsappAutoReplyEnabled?: boolean | null;
}

export interface PageChannelState {
    platform: ChannelPlatform;
    /** The channel's own auto-reply toggle. */
    on: boolean;
}

/** The connected channels on a card, in display order. Unconnected channels are absent. */
export function listPageChannels(page: PageChannelInput): PageChannelState[] {
    const channels: PageChannelState[] = [];
    if (page.facebookPageId) {
        channels.push({ platform: 'facebook', on: !!page.autoReplyEnabled });
    }
    if (page.instagramAccountId || page.instagramUsername) {
        channels.push({ platform: 'instagram', on: !!page.instagramAutoReplyEnabled });
    }
    if (page.whatsappConnected) {
        channels.push({ platform: 'whatsapp', on: !!page.whatsappAutoReplyEnabled });
    }
    return channels;
}

/** True when at least one connected channel is replying. A card with no connected channel is not. */
export function isAnyChannelReplying(page: PageChannelInput): boolean {
    return listPageChannels(page).some(c => c.on);
}
