import { describe, it, expect } from 'vitest';
import { buildReadMorePayload, parseReadMorePayload, POST_REPLY_CARD_CAPTION_MAX } from '../constants';

describe('Post Reply «Read more» postback payload', () => {
    it('round-trips a facebook payload', () => {
        const p = buildReadMorePayload('facebook', 'post-123');
        expect(p).toBe('pr_more:facebook:post-123');
        expect(parseReadMorePayload(p)).toEqual({ source: 'facebook', postId: 'post-123' });
    });

    it('round-trips an instagram payload', () => {
        expect(parseReadMorePayload(buildReadMorePayload('instagram', 'p1'))).toEqual({ source: 'instagram', postId: 'p1' });
    });

    it('rejects malformed / foreign payloads', () => {
        expect(parseReadMorePayload(null)).toBeNull();
        expect(parseReadMorePayload('')).toBeNull();
        expect(parseReadMorePayload('GET_STARTED')).toBeNull(); // some other bot payload
        expect(parseReadMorePayload('pr_more:facebook')).toBeNull(); // missing id
        expect(parseReadMorePayload('pr_more:twitter:p1')).toBeNull(); // bad source
        expect(parseReadMorePayload('pr_more::p1')).toBeNull(); // empty source
    });

    it('the caption threshold is a sane positive number', () => {
        expect(POST_REPLY_CARD_CAPTION_MAX).toBeGreaterThan(0);
        expect(POST_REPLY_CARD_CAPTION_MAX).toBeLessThanOrEqual(80); // Meta card title limit
    });
});
