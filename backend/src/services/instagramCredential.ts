import { config } from '../config';
import { GRAPH_API_BASE } from '../lib/fbAxios';
import { safeDecryptToken } from './facebookCrypto';

/**
 * Which credential — and therefore which Graph host — an Instagram call uses.
 *
 * Jawab24 reaches Instagram two ways, and they differ in BOTH the token and the
 * host. Every Instagram Graph call must be issued with a matching pair, so the
 * pair travels together as one object rather than as a loose token string:
 *
 *   Page-linked (`instagram_business_account` on a Facebook Page)
 *     token = `pages.access_token` (the Facebook Page token)
 *     host  = graph.facebook.com
 *
 *   Instagram-direct ("Instagram API with Instagram Login", no Facebook Page)
 *     token = `pages.instagram_access_token` (an Instagram User token)
 *     host  = graph.instagram.com
 *
 * A raw `accessToken: string` parameter cannot express that pairing, so a call
 * site could hand an Instagram User token to graph.facebook.com and get back an
 * opaque OAuth error. Making the credential a required object means the type
 * checker carries the host along with the token.
 *
 * Verified against Meta's docs 2026-08-16 — see `instagramMessagesEndpoint` for
 * the one endpoint whose PATH also differs.
 */
export interface InstagramCredential {
    /** Plaintext token to authenticate the call with. */
    accessToken: string;
    /** Graph base — host + API version, no trailing slash. */
    baseUrl: string;
    /** True for Instagram Login (Instagram-direct) accounts. */
    direct: boolean;
}

/**
 * Instagram Login's own Graph host. Same API version as the Facebook host: Meta
 * versions both from the same series, and pinning them apart would let the two
 * paths drift on shapes we parse identically.
 */
export const IG_DIRECT_GRAPH_BASE = `https://graph.instagram.com/${config.facebook.graphApiVersion}`;

/** Page-linked Instagram: the Facebook Page token against graph.facebook.com. */
export function pageLinkedInstagramCredential(pageAccessToken: string): InstagramCredential {
    return { accessToken: pageAccessToken, baseUrl: GRAPH_API_BASE, direct: false };
}

/**
 * THE decision point for Instagram-direct (Rule 19 — one choke point, no forked
 * reply logic downstream).
 *
 * The rule is deliberately BOTH halves of the row's shape: an Instagram User
 * token AND no Facebook Page. A row that has a Facebook Page keeps its proven
 * Page-linked path even if an Instagram User token is somehow also stored on it,
 * because switching a live page's host and credential is a change to shared
 * infrastructure with no upside — the Page token already works, and the
 * Instagram-direct path has different rate limits and error shapes. Connect
 * refuses to create that hybrid in the first place (`connectInstagramDirect`);
 * this predicate is the second line, so no future writer can silently move an
 * existing page onto the new host.
 *
 * Decryption happens here rather than at each loader so the resolver is correct
 * whichever query produced the row. `safeDecryptToken` is a no-op on plaintext
 * and degrades a corrupt token to `''`, which surfaces as a disconnected page
 * rather than as a crash on the reply hot path.
 */
export function resolveInstagramCredential(page: {
    id?: string;
    accessToken: string;
    facebookPageId?: string | null;
    instagramAccessToken?: string | null;
}): InstagramCredential {
    if (isInstagramDirectPage(page)) {
        const token = safeDecryptToken(page.instagramAccessToken, { entity: 'page', id: page.id });
        if (token) return { accessToken: token, baseUrl: IG_DIRECT_GRAPH_BASE, direct: true };
    }
    return pageLinkedInstagramCredential(page.accessToken);
}

/**
 * Is this page reached through Instagram Login rather than a Facebook Page?
 *
 * Read by everything that asks "which credential is this page's Instagram
 * traffic riding on" — most importantly Facebook page-token recovery, which has
 * no Facebook Page to re-mint from on such a row.
 */
export function isInstagramDirectPage(page: {
    facebookPageId?: string | null;
    instagramAccessToken?: string | null;
}): boolean {
    return Boolean(page.instagramAccessToken) && !page.facebookPageId;
}

/**
 * The messages edge — the ONE Instagram endpoint whose PATH differs between the
 * two credentials.
 *
 * Instagram Login documents `POST /{ig-id}/messages` on graph.instagram.com
 * (verified against Meta's docs 2026-08-16). The Page-linked path keeps
 * `/me/messages`, where `me` resolves through the Facebook Page token and has
 * served every Instagram send to date — it is deliberately left alone.
 */
export function instagramMessagesEndpoint(cred: InstagramCredential, instagramAccountId: string): string {
    return cred.direct
        ? `${cred.baseUrl}/${instagramAccountId}/messages`
        : `${cred.baseUrl}/me/messages`;
}

/**
 * The credential already resolved onto a PlatformPage by the Instagram adapters.
 *
 * The fallback covers a PlatformPage built somewhere that never ran the resolver
 * (tests, the playground, a Facebook page carrying Instagram columns) and keeps
 * the historical Page-token behaviour for it.
 */
export function instagramCredentialOf(page: {
    accessToken: string;
    instagramCredential?: InstagramCredential;
}): InstagramCredential {
    return page.instagramCredential ?? pageLinkedInstagramCredential(page.accessToken);
}
