import { describe, it, expect } from 'vitest';
import { listPageChannels, isAnyChannelReplying } from '../pageChannels';

describe('listPageChannels', () => {
    it('lists only connected channels, each with its own toggle', () => {
        expect(listPageChannels({
            facebookPageId: 'fb-1', autoReplyEnabled: true,
            instagramUsername: 'shop', instagramAutoReplyEnabled: false,
            whatsappConnected: true, whatsappAutoReplyEnabled: true,
        })).toEqual([
            { platform: 'facebook', on: true },
            { platform: 'instagram', on: false },
            { platform: 'whatsapp', on: true },
        ]);
    });

    it('a WhatsApp-only card carries no Facebook channel, whatever the Facebook column says', () => {
        expect(listPageChannels({ facebookPageId: null, autoReplyEnabled: false, whatsappConnected: true, whatsappAutoReplyEnabled: true }))
            .toEqual([{ platform: 'whatsapp', on: true }]);
    });

    it('Instagram counts as connected by account id OR username', () => {
        expect(listPageChannels({ instagramAccountId: 'ig-1' })).toEqual([{ platform: 'instagram', on: false }]);
        expect(listPageChannels({ instagramUsername: 'shop' })).toEqual([{ platform: 'instagram', on: false }]);
    });

    it('a WhatsApp number without a stored token is not a channel', () => {
        expect(listPageChannels({ whatsappConnected: false, whatsappAutoReplyEnabled: true })).toEqual([]);
    });

    it('a severed WhatsApp link carries needsReconnect while the toggle stays visible', () => {
        // The Z net shape (2026-09-01): token valid, toggle on, link severed at
        // Meta — the channel must read "configured to reply but broken".
        expect(listPageChannels({
            whatsappConnected: true, whatsappAutoReplyEnabled: true, whatsappNeedsReconnect: true,
        })).toEqual([{ platform: 'whatsapp', on: true, needsReconnect: true }]);
    });

    it('a healthy WhatsApp channel carries no needsReconnect key at all', () => {
        expect(listPageChannels({
            whatsappConnected: true, whatsappAutoReplyEnabled: true, whatsappNeedsReconnect: false,
        })).toEqual([{ platform: 'whatsapp', on: true }]);
    });
});

describe('isAnyChannelReplying', () => {
    it('is true when any connected channel is on', () => {
        expect(isAnyChannelReplying({ facebookPageId: 'fb-1', autoReplyEnabled: false, whatsappConnected: true, whatsappAutoReplyEnabled: true })).toBe(true);
    });

    it('is false when every connected channel is off, and when nothing is connected', () => {
        expect(isAnyChannelReplying({ facebookPageId: 'fb-1', autoReplyEnabled: false })).toBe(false);
        expect(isAnyChannelReplying({})).toBe(false);
    });

    it('ignores toggles of channels that are not connected', () => {
        // The regression: a false Facebook toggle on a card with no Facebook page.
        expect(isAnyChannelReplying({ autoReplyEnabled: true })).toBe(false);
        expect(isAnyChannelReplying({ facebookPageId: null, autoReplyEnabled: false, whatsappConnected: true, whatsappAutoReplyEnabled: true })).toBe(true);
    });

    it('a severed channel does not count as replying, even with its toggle on', () => {
        // The Z net incident: WhatsApp-only card, toggle on, link severed at Meta
        // — nothing was arriving while every surface said "replying".
        expect(isAnyChannelReplying({
            whatsappConnected: true, whatsappAutoReplyEnabled: true, whatsappNeedsReconnect: true,
        })).toBe(false);
        // Another healthy channel still counts.
        expect(isAnyChannelReplying({
            facebookPageId: 'fb-1', autoReplyEnabled: true,
            whatsappConnected: true, whatsappAutoReplyEnabled: true, whatsappNeedsReconnect: true,
        })).toBe(true);
    });
});
