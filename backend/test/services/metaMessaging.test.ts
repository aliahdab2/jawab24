import { describe, it, expect } from 'vitest';
import {
    buildGenericTemplateElements,
    buildMessagePayload,
    buildProductCardPayload,
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

        it('includes reply_to.mid when replyToMid is provided', () => {
            const payload = buildMessagePayload('user-1', { text: 'Hi' }, { replyToMid: 'm_abc' });
            expect(payload.reply_to).toEqual({ mid: 'm_abc' });
        });

        it('omits reply_to when replyToMid is undefined', () => {
            const payload = buildMessagePayload('user-1', { text: 'Hi' });
            expect(payload).not.toHaveProperty('reply_to');
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
});
