import { describe, it, expect } from 'vitest';
import {
    buildGenericTemplateElements,
    buildMessagePayload,
    buildCommentReplyPayload,
    buildProductCardPayload,
    imageAttachmentMessage,
    imageCardMessage,
    buttonTemplateMessage,
    META_TEMPLATE_LIMITS,
} from '../../src/services/metaMessaging';
import type { ProductCard } from '@jawab24/shared';

describe('metaMessaging', () => {
    describe('Post Reply image messages (single comment→DM reply)', () => {
        it('buildCommentReplyPayload addresses the comment (recipient.comment_id)', () => {
            const payload = buildCommentReplyPayload('cmt-1', { text: 'Hi' });
            expect(payload).toEqual({
                recipient: { comment_id: 'cmt-1' },
                message: { text: 'Hi' },
                messaging_type: 'RESPONSE',
            });
        });

        it('imageCardMessage: inline image + caption in the (capped) title', () => {
            const msg = imageCardMessage('https://cdn/x.jpg', 'كريم غو ريبير') as {
                attachment: { payload: { template_type: string; elements: { title: string; image_url: string }[] } };
            };
            expect(msg.attachment.payload.template_type).toBe('generic');
            expect(msg.attachment.payload.elements).toHaveLength(1);
            expect(msg.attachment.payload.elements[0]).toEqual({
                title: 'كريم غو ريبير',
                image_url: 'https://cdn/x.jpg',
                default_action: { type: 'web_url', url: 'https://cdn/x.jpg' },
            });
        });

        it('imageCardMessage: caps the title and never emits an empty title', () => {
            const long = 'x'.repeat(200);
            const msg = imageCardMessage('https://cdn/x.jpg', long) as { attachment: { payload: { elements: { title: string }[] } } };
            expect(msg.attachment.payload.elements[0].title).toHaveLength(META_TEMPLATE_LIMITS.maxTitleChars);

            const blank = imageCardMessage('https://cdn/x.jpg', '   ') as { attachment: { payload: { elements: { title: string }[] } } };
            expect(blank.attachment.payload.elements[0].title).toBe(' '); // Meta rejects an empty title
        });

        it('imageCardMessage: long caption → teaser title + a «Read more» POSTBACK button', () => {
            const msg = imageCardMessage('https://cdn/x.jpg', 'a'.repeat(200), { title: 'اقرأ المزيد', payload: 'pr_more:facebook:post-1' }) as {
                attachment: { payload: { elements: { title: string; buttons: { type: string; title: string; payload: string }[] }[] } };
            };
            const el = msg.attachment.payload.elements[0];
            expect(el.title).toHaveLength(META_TEMPLATE_LIMITS.maxTitleChars); // teaser
            expect(el.buttons).toEqual([{ type: 'postback', title: 'اقرأ المزيد', payload: 'pr_more:facebook:post-1' }]);
        });

        it('imageCardMessage: caps the «Read more» button title at 20', () => {
            const msg = imageCardMessage('https://cdn/x.jpg', 'hi', { title: 'z'.repeat(40), payload: 'pr_more:facebook:p1' }) as {
                attachment: { payload: { elements: { buttons: { title: string }[] }[] } };
            };
            expect(msg.attachment.payload.elements[0].buttons[0].title).toHaveLength(META_TEMPLATE_LIMITS.maxButtonTitleChars);
        });

        it('imageCardMessage: a CTA rides the card as a web_url button (after «Read more»)', () => {
            const msg = imageCardMessage('https://cdn/x.jpg', 'a'.repeat(200), { title: 'اقرأ المزيد', payload: 'pr_more:facebook:p1' }, { label: 'تسوّق', url: 'https://shop.example' }) as {
                attachment: { payload: { elements: { buttons: { type: string; title: string; url?: string; payload?: string }[] }[] } };
            };
            expect(msg.attachment.payload.elements[0].buttons).toEqual([
                { type: 'postback', title: 'اقرأ المزيد', payload: 'pr_more:facebook:p1' },
                { type: 'web_url', title: 'تسوّق', url: 'https://shop.example' },
            ]);
        });

        it('imageCardMessage: a short caption with a CTA has only the CTA button (no «Read more»)', () => {
            const msg = imageCardMessage('https://cdn/x.jpg', 'hi', undefined, { label: 'Shop', url: 'https://shop.example' }) as {
                attachment: { payload: { elements: { buttons: { type: string; url?: string }[] }[] } };
            };
            expect(msg.attachment.payload.elements[0].buttons).toEqual([{ type: 'web_url', title: 'Shop', url: 'https://shop.example' }]);
        });

        // Regression: the card's tap-through used to be the raw storage URL, so replacing or
        // clearing a Post Reply turned every already-sent card into a `NoSuchKey` XML page.
        it('imageCardMessage: default_action opens the STABLE view link, not the storage URL', () => {
            const msg = imageCardMessage(
                'https://s3.example/bucket/trigger-images/ws/abc.jpg',
                'hi',
                undefined,
                undefined,
                'https://jawab24.com/api/post-reply-image/facebook/post-1',
            ) as { attachment: { payload: { elements: { image_url: string; default_action: { type: string; url: string } }[] } } };
            const element = msg.attachment.payload.elements[0];
            expect(element.default_action).toEqual({
                type: 'web_url',
                url: 'https://jawab24.com/api/post-reply-image/facebook/post-1',
            });
            // image_url stays direct — Meta fetches it once at send time and caches its own copy.
            expect(element.image_url).toBe('https://s3.example/bucket/trigger-images/ws/abc.jpg');
        });

        it('imageCardMessage: falls back to the image URL when no view link is given', () => {
            const msg = imageCardMessage('https://cdn/x.jpg', 'hi') as {
                attachment: { payload: { elements: { default_action: { url: string } }[] } };
            };
            expect(msg.attachment.payload.elements[0].default_action.url).toBe('https://cdn/x.jpg');
        });

        it('buttonTemplateMessage: text + a single web_url button, text capped at 640', () => {
            const msg = buttonTemplateMessage('Check this out', { label: 'Shop now', url: 'https://shop.example/x' }) as {
                attachment: { type: string; payload: { template_type: string; text: string; buttons: { type: string; title: string; url: string }[] } };
            };
            expect(msg.attachment.type).toBe('template');
            expect(msg.attachment.payload.template_type).toBe('button');
            expect(msg.attachment.payload.text).toBe('Check this out');
            expect(msg.attachment.payload.buttons).toEqual([{ type: 'web_url', title: 'Shop now', url: 'https://shop.example/x' }]);
        });

        it('buttonTemplateMessage: caps text at 640 and the label at 20', () => {
            const msg = buttonTemplateMessage('x'.repeat(700), { label: 'y'.repeat(40), url: 'https://x.example' }) as {
                attachment: { payload: { text: string; buttons: { title: string }[] } };
            };
            expect(msg.attachment.payload.text).toHaveLength(640);
            expect(msg.attachment.payload.buttons[0].title).toHaveLength(META_TEMPLATE_LIMITS.maxButtonTitleChars);
        });
    });

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

    describe('imageAttachmentMessage', () => {
        it('builds a native image attachment message (not a template card)', () => {
            expect(imageAttachmentMessage('https://cdn/x.jpg')).toEqual({
                attachment: { type: 'image', payload: { url: 'https://cdn/x.jpg', is_reusable: false } },
            });
        });

        it('rides the shared envelope addressed to a PSID (recipient.id) with the RESPONSE default', () => {
            const payload = buildMessagePayload('user-1', imageAttachmentMessage('https://cdn/x.jpg')) as Record<string, unknown>;
            expect(payload.recipient).toEqual({ id: 'user-1' });
            expect(payload.messaging_type).toBe('RESPONSE');
            const attachment = (payload.message as Record<string, unknown>).attachment as Record<string, unknown>;
            expect(attachment.type).toBe('image');
            expect((attachment.payload as Record<string, unknown>).url).toBe('https://cdn/x.jpg');
        });
    });
});
