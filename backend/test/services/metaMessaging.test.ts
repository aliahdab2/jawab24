import { describe, it, expect } from 'vitest';
import {
    buildGenericTemplateElements,
    buildMessagePayload,
    buildProductCardPayload,
    buildImageCardElement,
    buildImageCardPayload,
    splitCardText,
    META_TEMPLATE_LIMITS,
} from '../../src/services/metaMessaging';
import type { ProductCard } from '@jawab24/shared';

describe('metaMessaging', () => {
    describe('buildMessagePayload', () => {
        it('defaults messaging_type to RESPONSE and omits tag', () => {
            const payload = buildMessagePayload('user-1', { text: 'Hi' });
            expect(payload).toEqual({
                recipient: { id: 'user-1' },
                message: { text: 'Hi' },
                messaging_type: 'RESPONSE',
            });
        });

        it('passes through messagingType and tag when provided', () => {
            const payload = buildMessagePayload(
                'user-1',
                { text: 'Update' },
                { messagingType: 'MESSAGE_TAG', tag: 'CONFIRMED_EVENT_UPDATE' },
            );
            expect(payload.messaging_type).toBe('MESSAGE_TAG');
            expect(payload.tag).toBe('CONFIRMED_EVENT_UPDATE');
        });
    });

    describe('buildGenericTemplateElements', () => {
        const baseCard: ProductCard = {
            title: 'Blue Cotton Shirt',
            subtitle: '120 SAR · In stock',
            imageUrl: 'https://cdn.example.com/shirt.jpg',
            productUrl: 'https://shop.example.com/products/blue-shirt',
        };

        it('maps a basic card without buttons', () => {
            const [el] = buildGenericTemplateElements([baseCard]);
            expect(el).toEqual({
                title: 'Blue Cotton Shirt',
                subtitle: '120 SAR · In stock',
                image_url: 'https://cdn.example.com/shirt.jpg',
                default_action: { type: 'web_url', url: 'https://shop.example.com/products/blue-shirt' },
            });
            expect(el.buttons).toBeUndefined();
        });

        it('truncates long titles and subtitles to Meta limits', () => {
            const long = 'x'.repeat(200);
            const [el] = buildGenericTemplateElements([{ ...baseCard, title: long, subtitle: long }]);
            expect(el.title.length).toBe(META_TEMPLATE_LIMITS.maxTitleChars);
            expect(el.subtitle.length).toBe(META_TEMPLATE_LIMITS.maxSubtitleChars);
        });

        it('caps cards at the Meta maximum', () => {
            const many = Array.from({ length: 25 }, (_, i) => ({ ...baseCard, title: `Item ${i}` }));
            expect(buildGenericTemplateElements(many)).toHaveLength(META_TEMPLATE_LIMITS.maxCards);
        });

        it('maps web_url and postback buttons with truncated titles', () => {
            const [el] = buildGenericTemplateElements([
                {
                    ...baseCard,
                    buttons: [
                        { type: 'web_url', title: 'View this fantastic product now', url: 'https://x.test' },
                        { type: 'postback', title: 'Tell me more please', payload: 'INFO_123' },
                        { type: 'web_url', title: 'Extra', url: 'https://y.test' },
                        { type: 'web_url', title: 'Overflow', url: 'https://z.test' },
                    ],
                },
            ]);
            expect(el.buttons).toHaveLength(META_TEMPLATE_LIMITS.maxButtonsPerCard);
            expect(el.buttons![0]).toEqual({ type: 'web_url', title: 'View this fantastic ', url: 'https://x.test' });
            expect(el.buttons![1]).toEqual({ type: 'postback', title: 'Tell me more please', payload: 'INFO_123' });
        });
    });

    describe('buildProductCardPayload', () => {
        it('wraps elements in a template attachment', () => {
            const card: ProductCard = {
                title: 't',
                subtitle: 's',
                imageUrl: 'https://i',
                productUrl: 'https://p',
            };
            const payload = buildProductCardPayload('user-1', [card]) as Record<string, unknown>;
            const message = payload.message as Record<string, unknown>;
            const attachment = message.attachment as Record<string, unknown>;
            expect(attachment.type).toBe('template');
            expect((attachment.payload as Record<string, unknown>).template_type).toBe('generic');
        });
    });

    describe('splitCardText', () => {
        it('keeps short text as title only (no subtitle)', () => {
            expect(splitCardText('Order now 🔥')).toEqual({ title: 'Order now 🔥' });
        });

        it('splits long text at a word boundary into title + subtitle', () => {
            const text = 'a'.repeat(50) + ' ' + 'b'.repeat(50);
            const { title, subtitle } = splitCardText(text);
            expect(title).toBe('a'.repeat(50));
            expect(subtitle).toBe('b'.repeat(50));
            expect(title.length).toBeLessThanOrEqual(META_TEMPLATE_LIMITS.maxTitleChars);
        });

        it('hard-cuts when there is no space within the title range', () => {
            const text = 'x'.repeat(100);
            const { title, subtitle } = splitCardText(text);
            expect(title.length).toBe(META_TEMPLATE_LIMITS.maxTitleChars);
            expect(subtitle).toBe('x'.repeat(20));
        });

        it('never yields an empty title', () => {
            expect(splitCardText('   ').title).toBe(' ');
        });
    });

    describe('buildImageCardElement', () => {
        it('builds a single element with the image and NO default_action', () => {
            const el = buildImageCardElement({ text: 'Hello', imageUrl: 'https://cdn/x.jpg' });
            expect(el.image_url).toBe('https://cdn/x.jpg');
            expect(el.title).toBe('Hello');
            expect(el.default_action).toBeUndefined();
        });

        it('caps title at the Meta limit', () => {
            const el = buildImageCardElement({ text: 'z'.repeat(200), imageUrl: 'https://cdn/x.jpg' });
            expect(el.title.length).toBeLessThanOrEqual(META_TEMPLATE_LIMITS.maxTitleChars);
        });
    });

    describe('buildImageCardPayload', () => {
        it('addresses a comment via recipient.comment_id (FB private reply)', () => {
            const el = buildImageCardElement({ text: 'Hi', imageUrl: 'https://cdn/x.jpg' });
            const payload = buildImageCardPayload({ comment_id: 'c-1' }, el) as Record<string, unknown>;
            expect(payload.recipient).toEqual({ comment_id: 'c-1' });
            const elements = ((payload.message as Record<string, unknown>).attachment as { payload: { elements: unknown[] } }).payload.elements;
            expect(elements).toHaveLength(1);
        });

        it('addresses a DM via recipient.id (IG)', () => {
            const el = buildImageCardElement({ text: 'Hi', imageUrl: 'https://cdn/x.jpg' });
            const payload = buildImageCardPayload({ id: 'u-1' }, el) as Record<string, unknown>;
            expect(payload.recipient).toEqual({ id: 'u-1' });
        });
    });
});
