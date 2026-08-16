import { describe, it, expect } from 'vitest';
import { mapToPlatformPage } from '../../../src/services/reply/adapters/shared';

/**
 * D-084 pin: mapToPlatformPage is the funnel every processor's page object
 * passes through before enrichPageContext. A prompt-relevant column that the
 * mapper drops produces a feature that works in the playground (full row) and
 * is silently dark in production — the Rule 19.2 drift, inverted. This suite
 * fails if brandVoiceNotesMulti ever falls out of the mapping.
 */
describe('mapToPlatformPage — per-page persona carried into the reply pipeline', () => {
    const row = {
        id: 'page-1',
        userId: 'user-1',
        workspaceId: 'ws-1',
        name: 'Test Page',
        accessToken: 'tok',
        knowledgeBase: 'kb',
        kbActiveVersion: 3,
        ecommerceStoreId: null,
        businessProfile: null,
    };

    it('forwards a page persona override', () => {
        const mapped = mapToPlatformPage(
            { ...row, brandVoiceNotesMulti: { ar: 'شخصية الصفحة' } },
            { autoReplyEnabled: true },
        );
        expect(mapped.brandVoiceNotesMulti).toEqual({ ar: 'شخصية الصفحة' });
    });

    it('normalizes an absent override to null (inherit)', () => {
        const mapped = mapToPlatformPage(row, { autoReplyEnabled: true });
        expect(mapped.brandVoiceNotesMulti).toBeNull();
    });
});
