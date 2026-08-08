import { describe, it, expect } from 'vitest';
import {
    classifyDmError,
    buildDmFailedFlagMeta,
    DmSendError,
} from '../utils/fbGraphErrors';

describe('classifyDmError — thread_owned_elsewhere (Handover Protocol conflict)', () => {
    // The exact production error from the MES trace (2026-08-08):
    // "(#100) The action is invalid since it's not the thread owner."
    const igError = new DmSendError(
        "Instagram API error: (#100) The action is invalid since it's not the thread owner.",
        { code: 100, subcode: 2534037, type: 'OAuthException' },
    );

    it('maps instagram 100/2534037 to thread_owned_elsewhere with full detail', () => {
        const f = classifyDmError(igError, 'instagram');
        expect(f.bucket).toBe('thread_owned_elsewhere');
        expect(f.code).toBe(100);
        expect(f.subcode).toBe(2534037);
        expect(f.fbMessage).toContain('not the thread owner');
    });

    it('maps facebook 100/2534037 the same way', () => {
        const f = classifyDmError(
            new DmSendError('Facebook API error: not the thread owner', { code: 100, subcode: 2534037 }),
            'facebook',
        );
        expect(f.bucket).toBe('thread_owned_elsewhere');
    });

    it('does NOT swallow other 100-subcodes: 100/2018001 stays customer_refused', () => {
        const f = classifyDmError(
            new DmSendError('No matching user found', { code: 100, subcode: 2018001 }),
            'instagram',
        );
        expect(f.bucket).toBe('customer_refused');
    });

});

describe('buildDmFailedFlagMeta — the single dm_failed flag_meta shape', () => {
    it('carries bucket, code, subcode, and fbMessage', () => {
        const meta = buildDmFailedFlagMeta({
            bucket: 'thread_owned_elsewhere',
            code: 100,
            subcode: 2534037,
            fbMessage: 'not the thread owner',
            rawMessage: 'raw',
        });
        expect(meta).toEqual({
            dm_failed: {
                bucket: 'thread_owned_elsewhere',
                code: 100,
                subcode: 2534037,
                fbMessage: 'not the thread owner',
            },
        });
    });

    it('omits absent fields instead of writing undefined/null (historical comment-path shape)', () => {
        const meta = buildDmFailedFlagMeta({ bucket: 'unknown', rawMessage: 'raw' });
        expect(meta).toEqual({ dm_failed: { bucket: 'unknown' } });
        expect(Object.keys(meta.dm_failed ?? {})).toEqual(['bucket']);
    });
});
