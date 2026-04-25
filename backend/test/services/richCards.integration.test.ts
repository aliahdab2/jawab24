import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ProductCard } from '@jawab24/shared';
import type { PlatformPage } from '../../src/interfaces';

/**
 * Rich Product Cards — backend pipeline integration
 *
 * Exercises the full path from a "reply with productCards" intent down to the
 * actual HTTP call landing on Meta's /me/messages endpoint:
 *
 *   adapter.sendProductCards
 *      → sendMetaProductCards (services/metaMessaging.ts)
 *         → buildProductCardPayload (services/metaMessaging.ts)
 *            → fbAxios.post (mocked at the boundary)
 *
 * The unit tests in metaMessaging.test.ts and productCardBuilder.test.ts cover
 * the layers in isolation. This file is the seam test: when a real adapter
 * hands us cards, do they reach Meta with the right payload shape?
 */

vi.mock('../../src/lib/fbAxios', () => ({
    fbAxios: { post: vi.fn().mockResolvedValue({ data: { message_id: 'mid_1' } }) },
    GRAPH_API_BASE: 'https://graph.facebook.com/v18.0',
}));

vi.mock('@sentry/node', () => ({ addBreadcrumb: vi.fn() }));

vi.mock('../../src/utils/tracing', () => ({
    tracedExternalCall: (_s: string, _m: string, fn: () => unknown) => fn(),
}));

vi.mock('../../src/services/conversations', () => ({
    conversationsService: {
        findByPageAndSender: vi.fn().mockResolvedValue(null),
        findOrCreate: vi.fn(),
        setSenderName: vi.fn(),
        getSenderName: vi.fn().mockResolvedValue(null),
    },
}));
vi.mock('../../src/services/pages', () => ({ pagesService: {} }));
vi.mock('../../src/lib/redis', () => ({
    redis: { get: vi.fn(), set: vi.fn(), quit: vi.fn() },
}));

import { fbAxios } from '../../src/lib/fbAxios';
import { facebookMessageAdapter } from '../../src/services/reply/adapters/facebookAdapter';
import { instagramMessageAdapter } from '../../src/services/reply/adapters/instagramAdapter';
import { sendMetaProductCards } from '../../src/services/metaMessaging';

const fbPost = vi.mocked(fbAxios.post);

const PAGE: PlatformPage = {
    id: 'page-uuid',
    userId: 'user-uuid',
    workspaceId: 'ws-1',
    name: 'Test Page',
    accessToken: 'PAGE_TOKEN',
    knowledgeBase: null,
    kbActiveVersion: null,
    autoReplyEnabled: true,
    platformAccountId: 'ig-account-1',
};

const SAMPLE_CARDS: ProductCard[] = [
    {
        title: 'Blue Cotton Shirt',
        subtitle: '120 SAR · In stock',
        imageUrl: 'https://cdn.test/shirt.jpg',
        productUrl: 'https://shop.test/products/blue-shirt',
        buttons: [{ type: 'web_url', title: 'View product', url: 'https://shop.test/products/blue-shirt' }],
    },
];

function lastFbCall() {
    expect(fbPost).toHaveBeenCalled();
    const calls = fbPost.mock.calls;
    return calls[calls.length - 1] as [string, Record<string, unknown>, { params?: Record<string, unknown> } | undefined];
}

describe('Rich Product Cards pipeline (integration)', () => {
    beforeEach(() => {
        fbPost.mockClear();
        fbPost.mockResolvedValue({ data: { message_id: 'mid_1' } } as never);
    });

    describe('Facebook Messenger adapter', () => {
        it('lands on /me/messages with a Generic Template attachment payload', async () => {
            await facebookMessageAdapter.sendProductCards!(PAGE, 'recipient-1', SAMPLE_CARDS);

            const [url, body, opts] = lastFbCall();
            expect(url).toBe('https://graph.facebook.com/v18.0/me/messages');

            // Auth via query param, not Authorization header
            expect(opts?.params).toEqual({ access_token: 'PAGE_TOKEN' });

            // Default messaging_type is RESPONSE — proactive sends are an opt-in opt
            expect(body.messaging_type).toBe('RESPONSE');
            expect(body.tag).toBeUndefined();

            // Recipient is the user ID (DM context)
            expect(body.recipient).toEqual({ id: 'recipient-1' });

            // Generic Template carousel
            const message = body.message as Record<string, unknown>;
            const attachment = message.attachment as Record<string, unknown>;
            expect(attachment.type).toBe('template');

            const payload = attachment.payload as { template_type: string; elements: Array<Record<string, unknown>> };
            expect(payload.template_type).toBe('generic');
            expect(payload.elements).toHaveLength(1);

            const el = payload.elements[0];
            expect(el.title).toBe('Blue Cotton Shirt');
            expect(el.subtitle).toBe('120 SAR · In stock');
            expect(el.image_url).toBe('https://cdn.test/shirt.jpg');
            expect(el.default_action).toEqual({ type: 'web_url', url: 'https://shop.test/products/blue-shirt' });
            expect(el.buttons).toEqual([
                { type: 'web_url', title: 'View product', url: 'https://shop.test/products/blue-shirt' },
            ]);
        });
    });

    describe('Instagram adapter', () => {
        it('lands on the same /me/messages endpoint with the same payload shape', async () => {
            await instagramMessageAdapter.sendProductCards!(PAGE, 'ig-recipient-1', SAMPLE_CARDS);

            const [url, body] = lastFbCall();
            // Same endpoint — Messenger and Instagram DM share /me/messages
            expect(url).toBe('https://graph.facebook.com/v18.0/me/messages');

            const message = body.message as Record<string, unknown>;
            const attachment = message.attachment as Record<string, unknown>;
            const payload = attachment.payload as { template_type: string };
            expect(payload.template_type).toBe('generic');
            expect(body.recipient).toEqual({ id: 'ig-recipient-1' });
        });
    });

    describe('Meta limits enforced before the request hits the wire', () => {
        it('truncates titles longer than 80 chars (Meta hard limit)', async () => {
            const long = 'x'.repeat(200);
            await sendMetaProductCards('TOK', 'rcp', [
                {
                    title: long,
                    subtitle: long,
                    imageUrl: 'https://cdn.test/x.jpg',
                    productUrl: 'https://shop.test/x',
                },
            ]);

            const [, body] = lastFbCall();
            const elements = (body.message as { attachment: { payload: { elements: Array<{ title: string; subtitle: string }> } } })
                .attachment.payload.elements;
            expect(elements[0].title.length).toBe(80);
            expect(elements[0].subtitle.length).toBe(80);
        });

        it('caps a 25-card carousel at 10 elements (Meta hard limit)', async () => {
            const many: ProductCard[] = Array.from({ length: 25 }, (_, i) => ({
                title: `Item ${i}`,
                subtitle: `${i} SAR`,
                imageUrl: 'https://cdn.test/x.jpg',
                productUrl: `https://shop.test/${i}`,
            }));

            await sendMetaProductCards('TOK', 'rcp', many);
            const [, body] = lastFbCall();
            const elements = (body.message as { attachment: { payload: { elements: unknown[] } } })
                .attachment.payload.elements;
            expect(elements).toHaveLength(10);
        });
    });

    describe('Proactive send tags (cart recovery, future)', () => {
        it('includes messaging_type=MESSAGE_TAG and the configured tag when provided', async () => {
            await sendMetaProductCards('TOK', 'rcp', SAMPLE_CARDS, {
                messagingType: 'MESSAGE_TAG',
                tag: 'POST_PURCHASE_UPDATE',
            });

            const [, body] = lastFbCall();
            expect(body.messaging_type).toBe('MESSAGE_TAG');
            expect(body.tag).toBe('POST_PURCHASE_UPDATE');
        });
    });

    describe('Empty input', () => {
        it('does not call the API when there are no cards (no-op)', async () => {
            await sendMetaProductCards('TOK', 'rcp', []);
            expect(fbPost).not.toHaveBeenCalled();
        });
    });
});
