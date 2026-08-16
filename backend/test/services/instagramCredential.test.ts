import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/config', () => ({
    config: { facebook: { graphApiVersion: 'v18.0' } },
}));

const mockSafeDecryptToken = vi.fn((stored: string | null | undefined) =>
    typeof stored === 'string' && stored.startsWith('enc:v1:') ? stored.slice(7) : (stored ?? ''),
);
vi.mock('../../src/services/facebookCrypto', () => ({
    safeDecryptToken: (...args: unknown[]) => mockSafeDecryptToken(...(args as [string])),
}));

import {
    resolveInstagramCredential,
    isInstagramDirectPage,
    pageLinkedInstagramCredential,
    instagramMessagesEndpoint,
    IG_DIRECT_GRAPH_BASE,
} from '../../src/services/instagramCredential';

const FB_BASE = 'https://graph.facebook.com/v18.0';

describe('instagramCredential', () => {
    describe('resolveInstagramCredential', () => {
        it('a page-linked row keeps the Facebook page token on graph.facebook.com', () => {
            const cred = resolveInstagramCredential({
                id: 'p1', accessToken: 'page-token', facebookPageId: 'fb-1', instagramAccessToken: null,
            });
            expect(cred).toEqual({ accessToken: 'page-token', baseUrl: FB_BASE, direct: false });
        });

        it('an Instagram-direct row uses the DECRYPTED Instagram token on graph.instagram.com', () => {
            const cred = resolveInstagramCredential({
                id: 'p2', accessToken: '', facebookPageId: null, instagramAccessToken: 'enc:v1:ig-token',
            });
            expect(cred).toEqual({
                accessToken: 'ig-token',
                baseUrl: IG_DIRECT_GRAPH_BASE,
                direct: true,
            });
            expect(IG_DIRECT_GRAPH_BASE).toBe('https://graph.instagram.com/v18.0');
        });

        // The rule is BOTH halves of the row shape. A page that still has a Facebook
        // Page must never be silently moved onto the new host+credential — that is a
        // live change to shared infrastructure with no upside.
        // Mutation-checked: dropping `&& !page.facebookPageId` from isInstagramDirectPage
        // fails only this case.
        it('a row that has BOTH a Facebook Page and an Instagram token stays page-linked', () => {
            const cred = resolveInstagramCredential({
                id: 'p3', accessToken: 'page-token', facebookPageId: 'fb-1', instagramAccessToken: 'enc:v1:ig-token',
            });
            expect(cred).toEqual({ accessToken: 'page-token', baseUrl: FB_BASE, direct: false });
        });

        // A corrupt token decrypts to '' (safeDecryptToken degrades rather than throws).
        // Falling back to the page token surfaces the row as disconnected instead of
        // sending an empty credential to graph.instagram.com on the reply hot path.
        it('falls back to the page credential when the Instagram token cannot be decrypted', () => {
            mockSafeDecryptToken.mockReturnValueOnce('');
            const cred = resolveInstagramCredential({
                id: 'p4', accessToken: '', facebookPageId: null, instagramAccessToken: 'enc:v1:broken',
            });
            expect(cred).toEqual({ accessToken: '', baseUrl: FB_BASE, direct: false });
        });
    });

    describe('isInstagramDirectPage', () => {
        it.each([
            [{ facebookPageId: null, instagramAccessToken: 'tok' }, true],
            [{ facebookPageId: 'fb-1', instagramAccessToken: 'tok' }, false],
            [{ facebookPageId: null, instagramAccessToken: null }, false],
            [{ facebookPageId: 'fb-1', instagramAccessToken: null }, false],
        ])('%o → %s', (page, expected) => {
            expect(isInstagramDirectPage(page)).toBe(expected);
        });
    });

    describe('instagramMessagesEndpoint', () => {
        // Verified against Meta's docs 2026-08-16: Instagram Login documents
        // POST /{ig-id}/messages, NOT /me/messages.
        it('Instagram-direct posts to /{ig-id}/messages on the Instagram host', () => {
            const cred = { accessToken: 't', baseUrl: IG_DIRECT_GRAPH_BASE, direct: true };
            expect(instagramMessagesEndpoint(cred, 'ig-999'))
                .toBe(`${IG_DIRECT_GRAPH_BASE}/ig-999/messages`);
        });

        it('page-linked keeps the historical /me/messages on the Facebook host', () => {
            expect(instagramMessagesEndpoint(pageLinkedInstagramCredential('t'), 'ig-999'))
                .toBe(`${FB_BASE}/me/messages`);
        });
    });
});
