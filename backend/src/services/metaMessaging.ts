/**
 * Shared Meta Graph API messaging primitives.
 *
 * Messenger and Instagram DM hit the same /me/messages endpoint with the same
 * payload shape — only the page access token differs. This module owns:
 *   - Type definitions (MessagingType, SendMessageOptions)
 *   - Payload normalization (Generic Template element building, truncation, limits)
 *   - The actual HTTP send (`sendMetaProductCards`) so platform services don't duplicate it
 *
 * Platform-specific concerns (Instagram-account-scoped lookups, FB-only error paths,
 * comment_id replies) stay in their respective services.
 */
import axios from 'axios';
import { fbAxios, GRAPH_API_BASE } from '../lib/fbAxios';
import { tracedExternalCall } from '../utils/tracing';
import { DmSendError } from '../utils/fbGraphErrors';
import type { ProductCard } from '@jawab24/shared';

/**
 * Meta messaging type hints for /me/messages.
 * - RESPONSE (default): valid within 24h of the user's last message.
 * - MESSAGE_TAG: proactive send; requires `tag` from Meta's approved list.
 * - UPDATE: reserved for policy-approved scenarios — avoid unless explicitly needed.
 */
export type MessagingType = 'RESPONSE' | 'UPDATE' | 'MESSAGE_TAG';

export interface SendMessageOptions {
    messagingType?: MessagingType;
    tag?: string;
}

// Meta's documented limits for the Generic Template.
export const META_TEMPLATE_LIMITS = {
    maxCards: 10,
    maxTitleChars: 80,
    maxSubtitleChars: 80,
    maxButtonsPerCard: 3,
    maxButtonTitleChars: 20,
} as const;

type MetaButton =
    | { type: 'web_url'; title: string; url?: string }
    | { type: 'postback'; title: string; payload?: string };

interface MetaTemplateElement {
    title: string;
    subtitle?: string;
    image_url: string;
    // Tapping the card opens this URL. Product cards deep-link to the product; a Post
    // Reply image card points at the image itself so the customer can open the full,
    // uncropped picture (the inline card thumbnail is cropped to ~1.91:1).
    default_action?: { type: 'web_url'; url: string; webview_height_ratio?: 'full' | 'tall' | 'compact' };
    buttons?: MetaButton[];
}

/**
 * Normalize `ProductCard[]` into the `elements` array of a Generic Template payload.
 * Truncates titles, subtitles, and button text defensively so a single oversized
 * string can't cause the whole send to fail with a Graph API error.
 */
export function buildGenericTemplateElements(cards: ProductCard[]): MetaTemplateElement[] {
    return cards.slice(0, META_TEMPLATE_LIMITS.maxCards).map((c) => {
        const element: MetaTemplateElement = {
            title: c.title.slice(0, META_TEMPLATE_LIMITS.maxTitleChars),
            subtitle: c.subtitle.slice(0, META_TEMPLATE_LIMITS.maxSubtitleChars),
            image_url: c.imageUrl,
            default_action: { type: 'web_url', url: c.productUrl },
        };

        if (c.buttons?.length) {
            element.buttons = c.buttons
                .slice(0, META_TEMPLATE_LIMITS.maxButtonsPerCard)
                .map<MetaButton>((b) => {
                    const title = b.title.slice(0, META_TEMPLATE_LIMITS.maxButtonTitleChars);
                    return b.type === 'web_url'
                        ? { type: 'web_url', title, url: b.url }
                        : { type: 'postback', title, payload: b.payload };
                });
        }

        return element;
    });
}

/**
 * Build the shared Graph API request body for a /me/messages send.
 * Callers POST this as-is to either the Messenger or Instagram /me/messages endpoint.
 */
type MetaRecipient = { id: string } | { comment_id: string };
type MetaMessage =
    | { text: string }
    | { attachment: { type: 'template'; payload: { template_type: 'generic'; elements: MetaTemplateElement[] } } };

/** The shared /me/messages request envelope (recipient + message + messaging_type/tag).
 *  Single source so text sends, product cards, and image cards can't drift. */
function buildMeMessageEnvelope(recipient: MetaRecipient, message: MetaMessage, opts?: SendMessageOptions): Record<string, unknown> {
    return {
        recipient,
        message,
        messaging_type: opts?.messagingType ?? 'RESPONSE',
        ...(opts?.tag ? { tag: opts.tag } : {}),
    };
}

/** Wrap a single generic-template element into a send-ready message body. */
function templateMessage(element: MetaTemplateElement): MetaMessage {
    return { attachment: { type: 'template', payload: { template_type: 'generic', elements: [element] } } };
}

export function buildMessagePayload(
    recipientId: string,
    message: MetaMessage,
    opts?: SendMessageOptions,
): Record<string, unknown> {
    return buildMeMessageEnvelope({ id: recipientId }, message, opts);
}

/**
 * Split a Post Reply caption into a card title (≤80) + optional subtitle (≤80).
 * Meta requires a non-empty title; the subtitle is included only when the text
 * overflows the title. Splits at a word boundary so a word is never cut mid-way.
 * The reply is validated ≤160 upstream, so both halves fit.
 */
export function splitCardText(text: string): { title: string; subtitle?: string } {
    const trimmed = text.trim();
    const max = META_TEMPLATE_LIMITS.maxTitleChars;
    if (trimmed.length <= max) {
        // Meta rejects an empty title — fall back to a single space if somehow blank.
        return { title: trimmed || ' ' };
    }
    const boundary = trimmed.lastIndexOf(' ', max);
    const splitAt = boundary > 0 ? boundary : max; // no space in range → hard cut
    const title = trimmed.slice(0, splitAt).trim() || trimmed.slice(0, max);
    const subtitle = trimmed.slice(splitAt).trim().slice(0, META_TEMPLATE_LIMITS.maxSubtitleChars);
    return subtitle ? { title, subtitle } : { title };
}

/**
 * Build a single Generic Template element for a Post Reply image card: image on top,
 * caption split across title/subtitle. No `default_action` (the image isn't a link).
 * Reply-type-agnostic — reusable by any future image-carrying reply.
 */
export function buildImageCardElement(opts: { text: string; imageUrl: string }): MetaTemplateElement {
    const { title, subtitle } = splitCardText(opts.text);
    return {
        title: title.slice(0, META_TEMPLATE_LIMITS.maxTitleChars),
        image_url: opts.imageUrl,
        // Make the card tappable → opens the full, uncropped image (the inline thumbnail
        // is cropped to ~1.91:1, unreadable for a portrait doc and lossy for a product
        // photo). A plain web_url (no messenger_extensions) needs no domain whitelisting.
        // Shared by both the FB and IG Post Reply image cards.
        default_action: { type: 'web_url', url: opts.imageUrl, webview_height_ratio: 'full' },
        ...(subtitle ? { subtitle } : {}),
    };
}

/** Build the /me/messages body for a single-element generic-template (image card). */
export function buildImageCardPayload(
    recipient: MetaRecipient,
    element: MetaTemplateElement,
    opts?: SendMessageOptions,
): Record<string, unknown> {
    return buildMeMessageEnvelope(recipient, templateMessage(element), opts);
}

/** Build the Generic Template attachment body for a product-card send. */
export function buildProductCardPayload(
    recipientId: string,
    cards: ProductCard[],
    opts?: SendMessageOptions,
): Record<string, unknown> {
    const elements = buildGenericTemplateElements(cards);
    return buildMessagePayload(
        recipientId,
        { attachment: { type: 'template', payload: { template_type: 'generic', elements } } },
        opts,
    );
}

/**
 * Send a Generic Template carousel via Meta's /me/messages endpoint.
 * Used by both Messenger and Instagram DM (same endpoint + payload).
 *
 * Returns the message ID on success (Instagram returns it; Messenger may not).
 * Empty `cards` is a no-op rather than an error so callers don't have to guard.
 *
 * On axios errors, throws a `DmSendError` that downstream code already handles.
 */
export async function sendMetaProductCards(
    pageAccessToken: string,
    recipientId: string,
    cards: ProductCard[],
    opts?: SendMessageOptions,
): Promise<string | undefined> {
    if (!cards.length) return undefined;
    try {
        const response = await tracedExternalCall('meta', 'sendProductCards', () =>
            fbAxios.post<{ message_id?: string }>(
                `${GRAPH_API_BASE}/me/messages`,
                buildProductCardPayload(recipientId, cards, opts),
                { params: { access_token: pageAccessToken } },
            ),
        );
        return response.data.message_id;
    } catch (error) {
        if (axios.isAxiosError(error)) {
            throw DmSendError.fromAxios(error, 'Meta API error');
        }
        throw error;
    }
}
