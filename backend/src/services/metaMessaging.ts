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
import { POST_REPLY_BUTTON_TEXT_MAX, type ProductCard } from '@jawab24/shared';

/**
 * Meta messaging type hints for /me/messages.
 * - RESPONSE (default): valid within 24h of the user's last message.
 * - MESSAGE_TAG: proactive send; requires `tag` from Meta's approved list.
 * - UPDATE: reserved for policy-approved scenarios — avoid unless explicitly needed.
 */
/**
 * Where a Meta message send is POSTed when the caller does not say otherwise.
 *
 * Every Messenger and Page-linked Instagram send has always gone here, and still
 * does. Instagram Login accounts are the exception — a different host AND a
 * different path (`instagramMessagesEndpoint`) — so they pass their own.
 */
const DEFAULT_MESSAGES_ENDPOINT = `${GRAPH_API_BASE}/me/messages`;

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
    // Optional: product cards deep-link to the product.
    default_action?: { type: 'web_url'; url: string };
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
    | { attachment: { type: 'image'; payload: { url: string; is_reusable?: boolean } } }
    | { attachment: { type: 'template'; payload: { template_type: 'generic'; elements: MetaTemplateElement[] } } }
    | { attachment: { type: 'template'; payload: { template_type: 'button'; text: string; buttons: MetaButton[] } } };

/** A Post Reply CTA link button: label + destination URL (both required). */
export interface CtaButton { label: string; url: string; }

/** Build the Messenger URL button for a CTA, with the label defensively truncated. */
function ctaWebUrlButton(cta: CtaButton): MetaButton {
    return { type: 'web_url', title: cta.label.slice(0, META_TEMPLATE_LIMITS.maxButtonTitleChars), url: cta.url };
}

/**
 * A Button Template: reply text + a single CTA link button, in the one message Meta allows
 * on a cold comment→DM. Used for a Post Reply CTA when NO image is attached (with an image the
 * button rides the generic image card instead). Text is capped at Meta's button-template limit.
 */
export function buttonTemplateMessage(text: string, cta: CtaButton): MetaMessage {
    return {
        attachment: {
            type: 'template',
            payload: {
                template_type: 'button',
                text: text.slice(0, POST_REPLY_BUTTON_TEXT_MAX) || ' ',
                buttons: [ctaWebUrlButton(cta)],
            },
        },
    };
}

/**
 * A one-element Generic Template that shows a Post Reply image INLINE with a caption — the
 * image is ALWAYS visible (Meta allows only one message on a cold comment→DM). `default_action`
 * makes the (necessarily ~1.91:1) card image tappable → opens the full-resolution image in the
 * in-app browser. `viewUrl` is what that tap opens: callers pass the STABLE resolver link
 * (buildPostReplyImageUrl) because the card outlives the storage key — see postReplyImage.ts.
 * It falls back to the image URL itself for callers with no stable link (previews, tests).
 * When the caption is too long to fit the title, the caller passes a `readMore`
 * postback button: the card shows a teaser, and tapping «Read more» delivers the full text as a
 * follow-up DM (the tap opens the 24h window). The image is not re-sent — it stays in this card
 * and is tappable to full size. Title falls back to a single space because Meta rejects an empty title.
 */
export function imageCardMessage(
    imageUrl: string,
    caption: string,
    readMore?: { title: string; payload: string },
    cta?: CtaButton,
    viewUrl?: string,
): MetaMessage {
    const title = caption.trim().slice(0, META_TEMPLATE_LIMITS.maxTitleChars) || ' ';
    const element: MetaTemplateElement = { title, image_url: imageUrl, default_action: { type: 'web_url', url: viewUrl || imageUrl } };
    // Up to 3 buttons per card: «Read more» (postback, when the caption is long) then the CTA
    // (web_url). Order puts the reply-completing action first, the outward link second.
    const buttons: MetaButton[] = [];
    if (readMore) buttons.push({ type: 'postback', title: readMore.title.slice(0, META_TEMPLATE_LIMITS.maxButtonTitleChars), payload: readMore.payload });
    if (cta) buttons.push(ctaWebUrlButton(cta));
    if (buttons.length) element.buttons = buttons;
    return { attachment: { type: 'template', payload: { template_type: 'generic', elements: [element] } } };
}

/** The shared /me/messages request envelope (recipient + message + messaging_type/tag).
 *  Single source so text sends, image attachments, and product cards can't drift. */
function buildMeMessageEnvelope(recipient: MetaRecipient, message: MetaMessage, opts?: SendMessageOptions): Record<string, unknown> {
    return {
        recipient,
        message,
        messaging_type: opts?.messagingType ?? 'RESPONSE',
        ...(opts?.tag ? { tag: opts.tag } : {}),
    };
}

/**
 * A native image-attachment message: the FULL, uncropped image the customer can tap to
 * open fullscreen (a generic-template card would crop to ~1.91:1 and split the caption).
 * Post Reply delivers this as its OWN message alongside the plain-text reply, because
 * Meta's Messenger/IG API has no single message type that carries body text + a full
 * image. `is_reusable: false` — the image is fetched by URL per send (no attachment_id
 * caching yet; see OBJECT_STORAGE.md).
 */
export function imageAttachmentMessage(url: string): MetaMessage {
    return { attachment: { type: 'image', payload: { url, is_reusable: false } } };
}

export function buildMessagePayload(
    recipientId: string,
    message: MetaMessage,
    opts?: SendMessageOptions,
): Record<string, unknown> {
    return buildMeMessageEnvelope({ id: recipientId }, message, opts);
}

/** Build a /me/messages body addressed to a COMMENT (one-shot private reply). Meta allows
 *  exactly one such message per comment, so the whole reply — text, card, or button
 *  template — must fit in this single send. */
export function buildCommentReplyPayload(
    commentId: string,
    message: MetaMessage,
    opts?: SendMessageOptions,
): Record<string, unknown> {
    return buildMeMessageEnvelope({ comment_id: commentId }, message, opts);
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
    endpoint: string = DEFAULT_MESSAGES_ENDPOINT,
): Promise<string | undefined> {
    if (!cards.length) return undefined;
    try {
        const response = await tracedExternalCall('meta', 'sendProductCards', () =>
            fbAxios.post<{ message_id?: string }>(
                endpoint,
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

/**
 * Send a native image attachment via Meta's /me/messages endpoint. Used by BOTH Messenger
 * and Instagram (identical endpoint + payload) — the second message of a Post Reply that
 * carries an image, delivered to the PSID after the text reply. Meta fetches the public
 * `imageUrl` server-side. Returns the message ID when Meta provides one. On axios errors,
 * throws a `DmSendError` that downstream failure handling already understands.
 */
export async function sendMetaImageAttachment(
    pageAccessToken: string,
    recipientId: string,
    imageUrl: string,
    opts?: SendMessageOptions,
    endpoint: string = DEFAULT_MESSAGES_ENDPOINT,
): Promise<string | undefined> {
    try {
        const response = await tracedExternalCall('meta', 'sendImageAttachment', () =>
            fbAxios.post<{ message_id?: string }>(
                endpoint,
                buildMessagePayload(recipientId, imageAttachmentMessage(imageUrl), opts),
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
