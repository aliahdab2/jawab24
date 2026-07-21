import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../src/config', () => ({
    config: { publicApiBaseUrl: 'https://jawab24.com/api/' },
}));

import { buildPostReplyImageUrl, POST_REPLY_IMAGE_ROUTE } from '../../../src/services/reply/postReplyImageLink';

describe('buildPostReplyImageUrl', () => {
    it('builds an absolute link on the public API origin, trimming a trailing slash', () => {
        expect(buildPostReplyImageUrl('facebook', 'post-1'))
            .toBe('https://jawab24.com/api/post-reply-image/facebook/post-1');
    });

    it('namespaces Instagram media separately', () => {
        expect(buildPostReplyImageUrl('instagram', 'media-1'))
            .toBe('https://jawab24.com/api/post-reply-image/instagram/media-1');
    });

    // The link is baked into DMs forever, so the route the server registers and the link we
    // hand out must stay the same path — a rename that hits only one side is unfixable later.
    it('matches the route the server registers', () => {
        expect(POST_REPLY_IMAGE_ROUTE).toBe('/post-reply-image/:source/:id');
        expect(buildPostReplyImageUrl('facebook', 'post-1'))
            .toContain(POST_REPLY_IMAGE_ROUTE.replace('/:source/:id', ''));
    });
});
